import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, lstat, unlink } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
import { root, stateDir, nativeBin } from './config.mjs';
import { isWin } from './os.mjs';
import { checkWork, signal, phase, execute } from './work.mjs';

const starting = new Map();
const localHelpers = new Map();
const readOnly = new Set(['ax_tree', 'screenshot', 'device_info', 'display_info', 'list_apps']);
let closing = false;

async function stopLocalHelper({ child, exited }) {
  child.kill('SIGTERM');
  const escalation = setTimeout(() => child.kill('SIGKILL'), 1000);
  try { await exited; }
  finally { clearTimeout(escalation); }
}

export async function closeLocalHelpers() {
  closing = true;
  await Promise.allSettled([...localHelpers.values()].map(stopLocalHelper));
}

export async function remoteDevices() {
  let configs;
  try { configs = JSON.parse(await readFile(join(stateDir, 'remote-devices.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!Array.isArray(configs)) throw new Error('remote-devices.json must contain an array.');
  return configs.map(config => {
    if (typeof config.id !== 'string' || typeof config.config_path !== 'string' || !isAbsolute(config.config_path)) throw new Error('Invalid remote device configuration.');
    return { id: config.id, name: config.name ?? config.id, kind: 'physical', connection: 'RemotePairing', remote: config.config_path };
  });
}

// On a host with no Unix domain socket the helper speaks over its own stdio instead: one
// request line in, one reply line out, and it stays alive so the RemotePairing tunnel is
// built once rather than per call. One helper per pairing file.
const helpers = new Map();
function stdioHelper(target) {
  if (helpers.has(target.remote)) return helpers.get(target.remote);
  const child = spawn(nativeBin, ['--remote', target.remote], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const entry = { child, failed: undefined, waiting: [] };
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => entry.waiting.shift()?.(line));
  const retire = error => {
    entry.failed = error ?? new Error('The remote helper stopped. Input may have been delivered; inspect before retrying.');
    for (const resolve of entry.waiting.splice(0)) resolve(undefined);
    lines.close();
    helpers.delete(target.remote);
  };
  child.once('exit', () => retire());
  child.once('error', () => retire(new Error('Cannot start the remote helper. Run bin/setup.')));
  child.stdin.on('error', () => {});
  child.unref();
  helpers.set(target.remote, entry);
  return entry;
}

function stdioRequest(target, request) {
  const entry = stdioHelper(target);
  if (entry.failed) return Promise.reject(entry.failed);
  return new Promise((resolve, reject) => {
    const callerSignal = signal();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value);
    };
    // A helper cannot be interrupted mid-request, so an abandoned request ends it and the
    // next one starts a new tunnel; the caller is told the input may have landed.
    const onAbort = () => {
      entry.child.kill();
      finish(callerSignal.reason ?? new Error('Remote request cancelled.'));
    };
    const timer = setTimeout(() => {
      entry.child.kill();
      finish(new DOMException('Remote operation timed out; inspect before retrying input.', 'TimeoutError'));
    }, 120000);
    callerSignal?.addEventListener('abort', onAbort, { once: true });
    entry.waiting.push(line => {
      if (line === undefined) { finish(entry.failed ?? new Error('The remote helper closed without answering.')); return; }
      let value;
      try { value = JSON.parse(line); } catch { finish(new Error('Invalid remote helper response. Inspect before retrying input.')); return; }
      // Structured refusals carry reason + instruction but no error field; keep them so the caller learns why.
      if (value?.isError) { finish(new Error(value.error ?? ([value.reason, value.instruction].filter(Boolean).join(': ') || 'The remote helper reported an error.'))); return; }
      finish(undefined, value);
    });
    entry.child.stdin.write(JSON.stringify(request) + '\n', error => {
      if (error) finish(new Error('The remote helper is not accepting requests.'));
    });
  });
}

// Windows has no Unix domain socket for a resident local helper, so a cable-connected phone is
// asked one request per helper process, as before.
async function oneShotRequest(target, request) {
  const { stdout } = await execute(nativeBin, ['--udid', target.id], { timeout: 95000, input: JSON.stringify(request) });
  return JSON.parse(stdout);
}

function connect(path) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once('error', reject);
    socket.once('connect', () => resolve(socket));
  });
}

async function socketFor(target) {
  // macOS reaches the helper through a Unix domain socket; Windows goes through stdio instead.
  if (isWin) return undefined;
  // macOS Unix socket names are limited to 104 bytes, regardless of the state directory's length.
  if (!target.remote && closing) throw new Error('Local native helpers are shutting down.');
  const directory = `/tmp/poki-${target.remote ? 'remote' : 'native'}-${process.getuid()}`;
  await mkdir(directory, { mode: 0o700, recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('Remote socket directory must be private and owned by this user.');
  const path = join(directory, createHash('sha256').update(target.remote ?? JSON.stringify([root, stateDir, process.pid, target.id])).digest('hex').slice(0, 24) + '.sock');
  try { return { socket: await connect(path), path }; }
  catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
  if (!starting.has(path)) {
    const started = (async () => {
      const previous = localHelpers.get(path);
      if (previous) await stopLocalHelper(previous);
      try {
        const stale = await lstat(path);
        if (!stale.isSocket() || stale.uid !== process.getuid()) throw new Error('Unexpected file at the remote socket path.');
        await unlink(path);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!target.remote && closing) throw new Error('Local native helpers are shutting down.');
      const args = target.remote ? ['--remote-server', target.remote, path] : ['--local-server', target.id, path];
      const child = spawn(join(root, 'build/poki-native'), args, { detached: Boolean(target.remote), stdio: [target.remote ? 'ignore' : 'pipe', 'pipe', process.env.POKI_MCP_NATIVE_TRACE ? 'inherit' : 'pipe'] });
      if (process.env.POKI_MCP_NATIVE_TRACE) console.error(JSON.stringify({ event: 'native_helper_started', pid: child.pid, transport: target.remote ? 'remote' : 'local' }));
      // Keep draining stderr for the helper's lifetime: a closed pipe would turn its later writes into a panic.
      let stderr = '';
      child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); }).unref();
      if (!target.remote) {
        const exited = once(child, 'exit').catch(() => {}).then(async () => {
          await unlink(path).catch(() => {});
          if (localHelpers.get(path)?.child === child) localHelpers.delete(path);
        });
        localHelpers.set(path, { child, exited });
        child.stdin.on('error', () => {});
      }
      const lines = createInterface({ input: child.stdout });
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { child.kill(); reject(new Error('Remote helper did not start.')); }, 5000);
          const done = (error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
          child.once('error', () => done(new Error('Cannot start remote helper. Run bin/setup.')));
          child.once('close', (code, signal) => {
            const status = signal ? `signal ${signal}` : `exit code ${code}`;
            const tail = stderr.trim().split('\n').slice(-5).join('\n');
            const hint = signal === 'SIGKILL' ? ' This can happen when build/poki-native is overwritten while an older helper still runs. Run ./bin/build-native again, then restart Poki.' : '';
            done(new Error(`${target.remote ? 'Remote' : 'Native'} helper stopped before becoming ready (${status}).${hint}${tail ? `\nHelper stderr:\n${tail}` : ''}`));
          });
          lines.once('line', line => { if (line === '{"ready":true}') done(); else done(new Error('Invalid remote helper greeting.')); });
        });
      } finally { lines.close(); child.stdout.destroy(); child.unref(); }
    })();
    starting.set(path, started);
    started.finally(() => starting.delete(path)).catch(() => {});
  }
  await starting.get(path);
  return { socket: await connect(path), path };
}

export async function nativeRequest(target, request) {
  checkWork();
  if (isWin) return target.remote ? stdioRequest(target, request) : oneShotRequest(target, request);
  const callerSignal = signal();
  const { socket, path } = await phase('native_helper', () => socketFor(target));
  try { checkWork(); } catch (error) { socket.destroy(); throw error; }
  return phase('native_request', () => new Promise((resolve, reject) => {
    const lines = createInterface({ input: socket });
    let pid, outcome, abortReason;
    const abort = reason => {
      abortReason = reason;
      socket.destroy();
    };
    const onAbort = () => abort(callerSignal.reason);
    const timer = setTimeout(() => abort(new DOMException('Remote operation timed out; inspect before retrying input.', 'TimeoutError')), 120000);
    callerSignal?.addEventListener('abort', onAbort, { once: true });
    lines.on('line', line => {
      if (abortReason) return;
      let value;
      try { value = JSON.parse(line); } catch { abort(new Error('Invalid remote helper response. Inspect before retrying input.')); return; }
      if (!pid) {
        if (!Number.isSafeInteger(value.pid) || value.pid <= 1) { abort(new Error('Invalid remote helper identity.')); return; }
        pid = value.pid;
        if (callerSignal?.aborted) { abort(callerSignal.reason); return; }
        socket.write(JSON.stringify(request) + '\n');
      } else { outcome = value; socket.end(); }
    });
    const helperName = target.remote ? 'Remote' : 'Native';
    socket.on('error', () => { abortReason ??= new Error(!target.remote && readOnly.has(request.op) ? 'Native helper connection closed during a read.' : `${helperName} helper connection closed. Input may have been delivered; inspect before retrying.`); });
    socket.once('close', async () => {
      clearTimeout(timer); lines.close();
      callerSignal?.removeEventListener('abort', onAbort);
      // A local helper finishes an abandoned read before serving anyone else, so end it as a one-shot read would end.
      const helper = !target.remote && pid && !outcome && abortReason && readOnly.has(request.op) && localHelpers.get(path);
      if (helper && helper.child.pid === pid) await stopLocalHelper(helper);
      if (abortReason) reject(abortReason);
      else if (!outcome) reject(new Error(`${helperName} helper closed without confirming the action. Inspect before retrying input.`));
      else if (outcome.transport_error) reject(new Error(outcome.error ?? 'Remote operation failed.'));
      else resolve(outcome);
    });
  }));
}
