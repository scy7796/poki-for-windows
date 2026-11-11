import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/tools.mjs';
import { createTaskGate, taskGateEnabled } from '../src/task-gate.mjs';

async function connect({ answer, elicitation = true, clock }) {
  const calls = [];
  const asked = [];
  const gate = createTaskGate({ env: {}, now: () => clock.t });
  const server = createServer(async name => { calls.push(name); return { content: [{ type: 'text', text: `ran ${name}` }] }; }, { gate });
  const client = new Client({ name: 'test', version: '0' }, elicitation ? { capabilities: { elicitation: { form: {} } } } : {});
  if (elicitation) client.setRequestHandler('elicitation/create', async request => { asked.push(request.params.message); return { action: await answer() }; });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  return { client, call, calls, asked, gate };
}

test('task gate is opt-in through POKI_MCP_TASK_APPROVAL=1', () => {
  assert.equal(taskGateEnabled({}), false);
  assert.equal(taskGateEnabled({ POKI_MCP_TASK_APPROVAL: '1' }), true);
});

test('device tools are refused before begin_task and pass after one approval', async () => {
  const clock = { t: 0 };
  const { call, calls, asked, client } = await connect({ answer: () => 'accept', clock });
  const listed = (await client.listTools()).tools.map(t => t.name);
  assert.ok(listed.includes('begin_task') && listed.includes('end_task'));

  const refused = await call('tap', { x: 1, y: 2 });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /no approved task/);
  assert.deepEqual(calls, []);

  assert.equal((await call('list_devices')).isError, undefined, 'status/inventory stay open');
  assert.deepEqual(calls, ['list_devices']);

  const begun = await call('begin_task', { task: 'Open Settings and search for Wi-Fi' });
  assert.notEqual(begun.isError, true);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /Open Settings and search for Wi-Fi/);
  assert.match(asked[0], /^An MCP client wants to use your iPhone/);

  for (const [name, args] of [['tap', {}], ['type_text', { text: 'hello' }], ['take_screenshot', {}], ['batch_commands', { commands: [{ tool: 'tap', args: { x: 1, y: 1 } }] }]]) {
    const result = await call(name, args);
    assert.notEqual(result.isError, true, `${name}: ${result.content?.[0]?.text}`);
  }
  assert.equal(asked.length, 1, 'one approval covers the whole task');
  assert.deepEqual(calls, ['list_devices', 'tap', 'type_text', 'take_screenshot', 'batch_commands']);

  await call('end_task');
  assert.equal((await call('tap')).isError, true, 'end_task closes the lease');
  assert.equal(calls.length, 5);
});

test('a declined approval leaves every device tool refused', async () => {
  const clock = { t: 0 };
  const { call, calls } = await connect({ answer: () => 'decline', clock });
  const begun = await call('begin_task', { task: 'send a message' });
  assert.equal(begun.isError, true);
  assert.match(begun.content[0].text, /did not approve/);
  assert.equal((await call('tap')).isError, true);
  assert.deepEqual(calls, []);
});

test('a client without elicitation cannot open a lease', async () => {
  const clock = { t: 0 };
  const { call, calls } = await connect({ answer: () => 'accept', elicitation: false, clock });
  const begun = await call('begin_task', { task: 'anything' });
  assert.equal(begun.isError, true);
  assert.equal((await call('tap')).isError, true);
  assert.deepEqual(calls, []);
});

test('the lease expires after ten idle minutes and after one hour in total', async () => {
  const clock = { t: 0 };
  const { call, calls } = await connect({ answer: () => 'accept', clock });
  await call('begin_task', { task: 'idle test' });
  clock.t = 9 * 60_000; assert.notEqual((await call('tap')).isError, true);
  clock.t = 19 * 60_000 + 1; assert.equal((await call('tap')).isError, true, 'idle > 10 min');

  await call('begin_task', { task: 'max test' });
  const start = clock.t;
  for (let i = 1; i <= 6; i++) { clock.t = start + i * 9 * 60_000; assert.notEqual((await call('tap')).isError, true); }
  clock.t = start + 60 * 60_000 + 1; assert.equal((await call('tap')).isError, true, 'total > 60 min');
  assert.equal(calls.length, 7);
});

test('a second begin_task drops the old lease even when declined', async () => {
  const clock = { t: 0 };
  const answers = ['accept', 'decline'];
  const { call } = await connect({ answer: () => answers.shift(), clock });
  await call('begin_task', { task: 'first' });
  assert.notEqual((await call('tap')).isError, true);
  await call('begin_task', { task: 'second, wider' });
  assert.equal((await call('tap')).isError, true);
});

// Answers are held back so end_task or a newer begin_task can run while an approval is open; leftovers are cancelled when the test ends.
async function connectDeferred(t) {
  const answers = [];
  const connection = await connect({ answer: () => new Promise(resolve => answers.push(resolve)), clock: { t: 0 } });
  t.after(() => { for (const answer of answers) answer('cancel'); });
  const asked = async count => {
    for (let turns = 0; answers.length < count; turns += 1) {
      assert.ok(turns < 1000, `expected ${count} approval prompts, saw ${answers.length}`);
      await new Promise(resolve => setImmediate(resolve));
    }
  };
  return { ...connection, answers, asked };
}

test('an approval answered after end_task does not open a lease', async t => {
  const { call, calls, answers, asked } = await connectDeferred(t);
  const first = call('begin_task', { task: 'first' });
  await asked(1);
  assert.notEqual((await call('end_task')).isError, true);
  answers[0]('accept');
  const begun = await first;
  assert.equal(begun.isError, true);
  assert.match(begun.content[0].text, /answer was ignored/);
  assert.equal((await call('tap')).isError, true);
  assert.deepEqual(calls, []);
});

test('an older approval answered after a newer begin_task does not open a lease', async t => {
  const { call, calls, answers, asked } = await connectDeferred(t);
  const first = call('begin_task', { task: 'first' });
  await asked(1);
  const second = call('begin_task', { task: 'second' });
  await asked(2);
  answers[1]('decline');
  assert.match((await second).content[0].text, /did not approve/);
  answers[0]('accept');
  assert.match((await first).content[0].text, /answer was ignored/);
  assert.equal((await call('tap')).isError, true);
  assert.deepEqual(calls, []);
});

test('the newest begin_task still opens a lease after an older one was answered late', async t => {
  const { call, calls, answers, asked } = await connectDeferred(t);
  const first = call('begin_task', { task: 'first' });
  await asked(1);
  const second = call('begin_task', { task: 'second' });
  await asked(2);
  answers[0]('accept');
  assert.match((await first).content[0].text, /answer was ignored/);
  assert.equal((await call('tap')).isError, true, 'the newer request is still unanswered');
  answers[1]('accept');
  assert.notEqual((await second).isError, true);
  assert.notEqual((await call('tap')).isError, true);
  assert.deepEqual(calls, ['tap']);
});

test('without a gate the server keeps its original tool list', async () => {
  const server = createServer(async () => ({ content: [] }));
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const names = (await client.listTools()).tools.map(t => t.name);
  assert.ok(!names.includes('begin_task'));
  assert.ok(names.includes('tap'));
});

test('POKI_MCP_TASK_APPROVAL_CLIENT names the client in the approval prompt', async () => {
  const asked = [];
  const gate = createTaskGate({ env: { POKI_MCP_TASK_APPROVAL_CLIENT: 'Assistant' }, now: () => 0 });
  const server = createServer(async () => ({ content: [] }), { gate });
  const client = new Client({ name: 'test', version: '0' }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler('elicitation/create', request => { asked.push(request.params.message); return { action: 'accept' }; });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  await client.callTool({ name: 'begin_task', arguments: { task: 'read the foreground app' } });
  assert.match(asked[0], /^Assistant wants to use your iPhone for this task:\nread the foreground app/);
});
