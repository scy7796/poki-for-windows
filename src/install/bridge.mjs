// Poki Setup's poki-setup-bridge over a pipe: one JSON request per line in, replies and progress
// events out (protocol in desktop/bridge/src/main.rs). Secrets go in over stdin, never in argv.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

export class BridgeError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

export class Bridge {
  #child;
  #next = 1;
  #pending = new Map();
  #listeners = new Set();

  static start(path, { env = {}, logFile, readyMs = 20000 } = {}) {
    const script = /\.m?js$/.test(path);
    const child = spawn(script ? process.execPath : path, script ? [path] : [], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    if (logFile) child.stderr.pipe(createWriteStream(logFile, { flags: 'a' }));
    else child.stderr.resume();
    const bridge = new Bridge(child);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new BridgeError('bridge_start_failed', `${path} did not say ready in ${readyMs / 1000} s`)); }, readyMs);
      child.once('error', error => { clearTimeout(timer); reject(new BridgeError('bridge_start_failed', `${path} did not start: ${error.message}`)); });
      child.once('exit', code => { clearTimeout(timer); reject(new BridgeError('bridge_start_failed', `${path} exited with ${code} before it was ready`)); });
      bridge.#ready = data => { clearTimeout(timer); child.removeAllListeners('exit'); child.on('exit', () => bridge.#closed()); resolve({ bridge, version: data?.version }); };
    });
  }

  #ready = () => {};

  constructor(child) {
    this.#child = child;
    createInterface({ input: child.stdout }).on('line', line => this.#line(line));
  }

  #line(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.event === 'ready') return this.#ready(message.data);
    if (message.event === 'progress') return this.#listeners.forEach(listener => listener(message.data));
    const waiter = this.#pending.get(message.id);
    if (!waiter) return;
    this.#pending.delete(message.id);
    if ('ok' in message) waiter.resolve(message.ok);
    else waiter.reject(new BridgeError(message.err?.kind ?? 'message', message.err?.message ?? 'unknown bridge error'));
  }

  #closed() {
    for (const waiter of this.#pending.values()) waiter.reject(new BridgeError('bridge_start_failed', 'Poki Setup\'s helper stopped while a request was running'));
    this.#pending.clear();
  }

  request(cmd, args = {}, { onProgress } = {}) {
    const id = this.#next++;
    if (onProgress) this.#listeners.add(onProgress);
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
    }).finally(() => onProgress && this.#listeners.delete(onProgress));
  }

  close() {
    this.#child.stdin.end();
    setTimeout(() => this.#child.kill(), 2000).unref();
  }
}
