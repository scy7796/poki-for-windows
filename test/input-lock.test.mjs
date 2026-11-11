import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Coordination } from '../src/coordination.mjs';
import { inputLockFromEnv, deviceKey } from '../src/input-lock.mjs';
import { fixture } from './fixture.mjs';

const lockOn = (env = {}) => inputLockFromEnv({ POKI_INPUT_LOCK: '1', POKI_INPUT_LOCK_WAIT_MS: '1000', ...env });

// A session stand-in: dispatch records when each tool starts and ends and takes `ms` to run.
function session(label, log, ms = 40) {
  return {
    label, selected: 'phone-a', backgroundDevices: new Map(),
    async dispatch(name, args) {
      log.push(`${label}:${name}:start`);
      await sleep(args?.ms ?? ms);
      log.push(`${label}:${name}:end`);
      return { content: [{ type: 'text', text: name }] };
    },
    async cleanup() { return {}; },
  };
}

test('input lock is off unless POKI_INPUT_LOCK=1, and reads its limits from the environment', () => {
  assert.equal(inputLockFromEnv({}), undefined);
  const lock = inputLockFromEnv({ POKI_INPUT_LOCK: '1', POKI_INPUT_LOCK_WAIT_MS: '250', POKI_MAX_CONCURRENT_READS: '2' });
  assert.equal(lock.waitMs, 250);
  assert.equal(lock.maxReads, 2);
  assert.equal(inputLockFromEnv({ POKI_INPUT_LOCK: '1' }).waitMs, 30000);
  assert.equal(inputLockFromEnv({ POKI_INPUT_LOCK: '1' }).maxReads, 4);
  assert.throws(() => inputLockFromEnv({ POKI_INPUT_LOCK: '1', POKI_INPUT_LOCK_WAIT_MS: 'soon' }), /POKI_INPUT_LOCK_WAIT_MS/);
});

test('the lock is keyed by the id each step resolves to, and covers every device when that is unclear', async () => {
  const session = { selected: 'b', resolveDevice: async device => ({ 'Phone A': 'a', a: 'a', c: 'c', 'Sim C': 'c' })[device] };
  assert.equal(await deviceKey(session, { device: 'Phone A' }), 'a');
  assert.equal(await deviceKey(session, { simulator: 'Sim C' }), 'c');
  assert.equal(await deviceKey(session, { commands: [{ tool: 'tap', arguments: { device: 'c' } }, { tool: 'tap', arguments: { device: 'Sim C' } }] }), 'c');
  assert.equal(await deviceKey(session, { commands: [{ arguments: { device: 'c' } }, { arguments: { device: 'a' } }] }), '*');
  assert.equal(await deviceKey(session, { commands: [{ arguments: { device: 'c' } }, { arguments: {} }] }), '*');
  assert.equal(await deviceKey(session, { device: 'A phone not seen yet' }), '*');
  assert.equal(await deviceKey(session, { model: 'iPhone 17' }), '*');
  assert.equal(await deviceKey(session, {}), 'b');
  assert.equal(await deviceKey({}, {}), '*');
});

test('without the lock every session shares one queue, as before', async () => {
  const coordinator = new Coordination(); coordinator.inputLock = undefined;
  const log = [], a = session('a', log), b = session('b', log);
  await Promise.all([coordinator.call(a, 'tap', {}), coordinator.call(b, 'take_screenshot', {})]);
  assert.deepEqual(log, ['a:tap:start', 'a:tap:end', 'b:take_screenshot:start', 'b:take_screenshot:end']);
});

test('with the lock, a read from another session runs while input holds the device', async () => {
  const coordinator = new Coordination(); coordinator.inputLock = lockOn();
  const log = [], a = session('a', log, 80), b = session('b', log, 10);
  await Promise.all([coordinator.call(a, 'tap', {}), sleep(5).then(() => coordinator.call(b, 'take_screenshot', {}))]);
  assert.deepEqual(log, ['a:tap:start', 'b:take_screenshot:start', 'b:take_screenshot:end', 'a:tap:end']);
});

test('with the lock, input from two sessions to one device runs one at a time', async () => {
  const coordinator = new Coordination(); coordinator.inputLock = lockOn();
  const log = [], a = session('a', log), b = session('b', log);
  await Promise.all([coordinator.call(a, 'tap', {}), coordinator.call(b, 'type_text', { text: 'x' })]);
  assert.deepEqual(log, ['a:tap:start', 'a:tap:end', 'b:type_text:start', 'b:type_text:end']);
});

test('with the lock, input to two different devices runs side by side', async () => {
  const coordinator = new Coordination(); coordinator.inputLock = lockOn();
  const log = [], a = session('a', log), b = session('b', log);
  b.selected = 'phone-b';
  await Promise.all([coordinator.call(a, 'tap', {}), coordinator.call(b, 'tap', {})]);
  assert.deepEqual(log.slice(0, 2), ['a:tap:start', 'b:tap:start']);
});

test('with the lock, one session keeps its own order even for reads', async () => {
  const coordinator = new Coordination(); coordinator.inputLock = lockOn();
  const log = [], a = session('a', log);
  await Promise.all([coordinator.call(a, 'tap', { ms: 40 }), coordinator.call(a, 'take_screenshot', { ms: 5 })]);
  assert.deepEqual(log, ['a:tap:start', 'a:tap:end', 'a:take_screenshot:start', 'a:take_screenshot:end']);
});

test('a session that waits too long gets an error naming the holder and its tool', async () => {
  const coordinator = new Coordination(); coordinator.inputLock = lockOn({ POKI_INPUT_LOCK_WAIT_MS: '50' });
  const log = [], a = session('agent-a', log, 300), b = session('agent-b', log);
  const first = coordinator.call(a, 'drag', {});
  await sleep(5);
  await assert.rejects(coordinator.call(b, 'tap', {}), error => {
    assert.equal(error.name, 'InputLockTimeout');
    assert.match(error.message, /Device phone-a is busy/);
    assert.match(error.message, /Session agent-a is running drag/);
    assert.match(error.message, /Waited 50 ms/);
    return true;
  });
  assert.ok(!log.includes('agent-b:tap:start'));
  await first;
  // The failed wait leaves the lock usable.
  await coordinator.call(b, 'tap', { ms: 1 });
  assert.ok(log.includes('agent-b:tap:end'));
});

test('an unknown device excludes input to every device', async () => {
  const lock = lockOn();
  const releaseAny = await lock.acquire('*', { session: 's', tool: 'launch_app' });
  let got = false;
  const pending = lock.acquire('phone-a', { session: 't', tool: 'tap' }).then(release => { got = true; return release; });
  await sleep(10);
  assert.equal(got, false);
  releaseAny();
  (await pending)();
  assert.equal(got, true);
  (await lock.acquire('*', { session: 'u', tool: 'tap' }))();
});

test('reads are capped at POKI_MAX_CONCURRENT_READS', async () => {
  const coordinator = new Coordination(); coordinator.inputLock = lockOn({ POKI_MAX_CONCURRENT_READS: '2' });
  const log = [], sessions = ['a', 'b', 'c'].map(name => session(name, log, 30));
  let peak = 0, running = 0;
  for (const s of sessions) { const run = s.dispatch.bind(s); s.dispatch = async (...args) => { peak = Math.max(peak, ++running); try { return await run(...args); } finally { running--; } }; }
  await Promise.all(sessions.map(s => coordinator.call(s, 'take_screenshot', {})));
  assert.equal(peak, 2);
  assert.equal(log.filter(entry => entry.endsWith(':end')).length, 3);
});

test('an aborted wait leaves the queue and does not run', async () => {
  const coordinator = new Coordination(); coordinator.inputLock = lockOn();
  const log = [], a = session('a', log, 100), b = session('b', log);
  const first = coordinator.call(a, 'tap', {});
  const controller = new AbortController();
  const second = coordinator.call(b, 'tap', {}, controller.signal);
  await sleep(10);
  controller.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(second, /stop/);
  await first;
  assert.ok(!log.includes('b:tap:start'));
  await coordinator.call(b, 'tap', { ms: 1 });
  assert.ok(log.includes('b:tap:end'));
});

test('a phone named by one session and given by its UDID in another takes one input lock', { timeout: 30000 }, async t => {
  const f = await fixture(t, { extraEnv: () => ({ POKI_INPUT_LOCK: '1', POKI_INPUT_LOCK_WAIT_MS: '500' }) });
  const b = await f.connect();
  await f.call('list_devices');
  await f.set({ block: 'tap' });
  const taps = log => log.split('\n').filter(line => line.startsWith('{"op":"tap"')).length;
  const first = f.call('tap', { device: 'Fixture Phone', x: 10, y: 10 });
  first.catch(() => {});
  await f.until(log => taps(log) === 1);
  const second = await Promise.race([
    b.callTool({ name: 'tap', arguments: { device: 'fixture-phone', x: 10, y: 10 } }),
    f.until(log => taps(log) === 2).then(() => 'a second tap reached the phone while the first held it'),
  ]);
  assert.equal(second.isError, true, String(second));
  assert.match(second.content[0].text, /busy with input from another session/);
  assert.equal((await f.events()).filter(event => event.op === 'tap').length, 1);
});

// A cancellation can arrive while Coordination is still resolving the device or waiting
// for this session's earlier call, before the lock installs its abort listener.
test('already cancelled work cannot enter either lock queue', async () => {
  const lock = lockOn();
  const controller = new AbortController();
  controller.abort(new DOMException('cancelled before lock entry', 'AbortError'));
  await assert.rejects(lock.acquire('phone-a', { session: 'cancelled', tool: 'tap' }, controller.signal), /cancelled before lock entry/);
  await assert.rejects(lock.readSlot(controller.signal), /cancelled before lock entry/);
  assert.equal(lock.holders.size, 0);
  assert.equal(lock.reads, 0);
  const input = await lock.acquire('phone-a', { session: 'holder', tool: 'tap' });
  const read = await lock.readSlot();
  lock.maxReads = 1;
  try {
    await assert.rejects(lock.acquire('*', { session: 'cancelled', tool: 'tap' }, controller.signal), /cancelled before lock entry/);
    await assert.rejects(lock.readSlot(controller.signal), /cancelled before lock entry/);
    assert.equal(lock.waiters.size, 0);
    assert.equal(lock.readWaiters.length, 0);
  } finally { input(); read(); }
});

test('cancellation during device resolution does not leave a lock waiter behind', async () => {
  const coordinator = new Coordination(); coordinator.inputLock = lockOn();
  const log = [], a = session('cancelled', log);
  let resolveDevice, resolving;
  const entered = new Promise(resolve => { resolving = resolve; });
  a.resolveDevice = () => { resolving(); return new Promise(resolve => { resolveDevice = resolve; }); };
  const held = await coordinator.inputLock.acquire('phone-a', { session: 'holder', tool: 'tap' });
  const controller = new AbortController();
  const call = coordinator.call(a, 'tap', { device: 'Phone A' }, controller.signal);
  await entered;
  controller.abort(new DOMException('cancelled during resolution', 'AbortError'));
  await assert.rejects(call, /cancelled during resolution/);
  resolveDevice('phone-a');
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(coordinator.inputLock.waiters.size, 0, 'cancelled work must not wait for the device after the client has returned');
    assert.deepEqual(log, []);
  } finally { held(); await a.queue; }
});
