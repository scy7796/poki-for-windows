#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, lstat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';

const binary = process.argv[2] ?? resolve(import.meta.dirname, '../build/poki-native');
const directory = await mkdtemp('/tmp/poki-lifecycle-');
const path = join(directory, 'native.sock');
const child = spawn(binary, ['--local-server', 'protocol-only-no-device', path], { stdio: ['pipe', 'pipe', 'pipe'] });
const exited = once(child, 'close');
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
const lines = createInterface({ input: child.stdout });
const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
let socket;
try {
  const [ready] = await Promise.race([once(lines, 'line'), exited.then(([code, signal]) => { throw new Error(`Native helper exited before ready (${signal ? `signal ${signal}` : `exit code ${code}`}).${stderr.trim() ? `\nHelper stderr:\n${stderr.trim()}` : ''}`); })]);
  assert.equal(ready, '{"ready":true}');
  socket = createConnection(path);
  const replies = createInterface({ input: socket });
  const [hello] = await once(replies, 'line');
  assert.equal(JSON.parse(hello).pid, child.pid);
  const response = once(replies, 'line');
  socket.write(JSON.stringify({ op: 'release_input' }) + '\n');
  assert.deepEqual(JSON.parse((await response)[0]), { released: true });
  socket.destroy(); replies.close();
  socket = createConnection(path);
  const launch = createInterface({ input: socket });
  await once(launch, 'line');
  const launched = once(launch, 'line');
  socket.write(JSON.stringify({ op: 'launch_app', bundle_id: 'com.apple.Preferences' }) + '\n');
  const outcome = JSON.parse((await launched)[0]);
  assert.equal(outcome.outcome, 'not_sent', `A launch that cannot reach the device was not sent: ${JSON.stringify(outcome)}`);
  socket.destroy(); launch.close();
  socket = createConnection(path);
  const touch = createInterface({ input: socket });
  await once(touch, 'line');
  const touched = once(touch, 'line');
  socket.write(JSON.stringify({ op: 'tap', x: 100, y: 200 }) + '\n');
  const tap = JSON.parse((await touched)[0]);
  assert.equal(tap.outcome, 'not_sent', `A tap that cannot reach the device was not sent: ${JSON.stringify(tap)}`);
  assert.equal(tap.stop_reason, 'error', 'An unsent tap is an ordinary failure for stop_on_error to decide');
  socket.destroy(); touch.close();
  child.stdin.end();
  const [code] = await exited;
  assert.equal(code, 0, 'Local helper exits when its daemon pipe closes');
  await assert.rejects(lstat(path), { code: 'ENOENT' }, 'Local helper removes its socket on owner exit');
  console.log('PASS: real native helper identity, release_input, not_sent launch and tap without a device, owner EOF shutdown, and socket cleanup; no device connected');
} finally {
  clearTimeout(timeout); socket?.destroy(); lines.close();
  child.kill('SIGKILL'); await exited;
  await rm(directory, { recursive: true, force: true });
}
