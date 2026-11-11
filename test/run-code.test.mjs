import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, value } from './fixture.mjs';

const summaryOf = result => JSON.parse(result.content.find(block => block.type === 'text').text);
const runCode = (f, code, extra = {}) => f.call('run_code', { code, ...extra });

// ESP-151 acceptance 1 mechanics: a multi-step task runs in one call, the code reads a structured
// receipt, derives its answer, and the result records each tool call's name, time and receipt.
test('run_code runs several steps in one call and returns a value derived from a tool receipt', async t => {
  const f = await fixture(t);
  const result = await runCode(f, `
    const seen = await tools.list_elements();
    let total = 0;
    for (const element of seen.elements) total += 1;
    return { label: seen.elements[0].label, count: total };
  `);
  assert.ok(!result.isError, JSON.stringify(result));
  const summary = summaryOf(result);
  assert.deepEqual(summary.result, { label: 'First', count: 1 });
  assert.equal(summary.completed_calls, 1);
  assert.equal(summary.calls[0].tool, 'list_elements');
  assert.ok(Number.isFinite(summary.calls[0].elapsed_ms) && summary.calls[0].elapsed_ms >= 0);
  assert.match(summary.calls[0].receipt, /"label":\s*"First"/);
});

// The run_code description promises that each tools.<name> call returns what a direct call returns.
// A script that scrolls and then reads the screen from the receipt relies on that readback.
test('run_code returns an action with the screen it produced, as a direct call does', async t => {
  const f = await fixture(t);
  await f.set({ label: 'Row 1', afterInput: { label: 'Row 9' } });
  const result = await runCode(f, `
    const moved = await tools.scroll({ direction: 'down' });
    return { verified: moved.screen_change_verified, changed: moved.screen_changed, shows: moved.screen.text.includes('Button: Row 9') };
  `);
  assert.ok(!result.isError, JSON.stringify(result));
  assert.deepEqual(summaryOf(result).result, { verified: true, changed: true, shows: true });
});

// ESP-151 acceptance 2: require, a bare file-system module, fetch, process and dynamic import are all
// absent in the sandbox; each throws inside the script and the daemon keeps serving afterwards.
test('run_code denies require, fetch, process and dynamic import, and the daemon keeps serving', async t => {
  const f = await fixture(t);
  const cases = [
    [`require('fs')`, /require is not defined/],
    [`fetch('http://example.com')`, /fetch is not defined/],
    [`process.exit(0)`, /process is not defined/],
    [`await import('node:fs')`, /dynamic import callback was not specified/],
  ];
  for (const [code, expected] of cases) {
    const result = await runCode(f, code);
    assert.equal(result.isError, true, code);
    const summary = summaryOf(result);
    assert.match(summary.script_error, expected, code);
  }
  assert.equal(value(await f.call('wait', { seconds: 0 })).waited, 0);
});

// A return value JSON cannot carry ends as a script error that keeps the call list, not a parse failure.
test('run_code reports a return value that is not JSON as a script error and keeps its calls', async t => {
  const f = await fixture(t);
  const result = await runCode(f, `await tools.wait({ seconds: 0 }); return () => 1;`);
  assert.equal(result.isError, true);
  const summary = summaryOf(result);
  assert.match(summary.script_error, /not JSON/);
  assert.deepEqual(summary.calls.map(call => call.tool), ['wait']);
});

// ESP-151 acceptance 3: an action receipt with sent=false stops the script even inside try/catch, and
// the steps after it never run. The report carries the stopped step and the steps already executed.
test('run_code stops when an action reports sent=false, and no later step runs even under try/catch', async t => {
  const f = await fixture(t);
  await f.set({ inputReply: { isError: true, outcome: 'not_sent', stop_reason: 'error', sent: false, screen_change_verified: false, reason: 'display_service_missing', error: 'Cannot establish input media session: no display service: ServiceNotFound', instruction: 'Nothing reached the iPhone.' } });
  const result = await runCode(f, `
    try { await tools.tap({ x: 10, y: 10 }); }
    catch (error) { await tools.tap({ x: 20, y: 20 }); }
    return 'the script continued';
  `);
  assert.equal(result.isError, true);
  const summary = summaryOf(result);
  assert.equal(summary.stop_reason, 'not_sent');
  assert.equal(summary.stopped_step.tool, 'tap');
  assert.equal(summary.stopped_step.receipt.sent, false);
  assert.equal(summary.result, undefined, 'the script must not resume past a non-delivered action');
  assert.equal((await f.events()).filter(event => event.op === 'tap').length, 1, 'the catch block and the steps after it must not run');
});

// ESP-151 acceptance 4: a script that times out cancels the device call in progress and releases the
// device, and the daemon serves the next session. A synchronous infinite loop is also stopped.
test('run_code times out, cancels the in-flight device call, and the daemon serves the next call', async t => {
  const f = await fixture(t), other = await f.connect();
  await f.set({ block: 'ax_tree' });
  // get_foreground_app reaches the native read directly, so the read is in flight well before the deadline.
  const blocked = runCode(f, `await tools.get_foreground_app(); return 'read the screen';`, { timeout_seconds: 5 });
  await f.until(log => log.includes('"op":"ax_tree"'));
  const result = await blocked;
  assert.equal(result.isError, true);
  const summary = summaryOf(result);
  assert.equal(summary.stop_reason, 'timeout');
  assert.deepEqual(summary.calls.map(call => [call.tool, call.interrupted]), [['get_foreground_app', true]], 'the report names the call the timeout cut off');
  assert.equal((await f.events()).filter(event => event.op === 'ax_tree').length, 1, 'the blocked read must not be retried');
  await f.set({});
  assert.equal(value(await other.callTool({ name: 'wait', arguments: { seconds: 0 } })).waited, 0, 'the device must be free for the next session');
  const spin = await runCode(f, `while (true) {}`, { timeout_seconds: 1 });
  assert.equal(spin.isError, true);
  assert.equal(summaryOf(spin).stop_reason, 'timeout');
  assert.equal(value(await f.call('wait', { seconds: 0 })).waited, 0, 'the daemon keeps serving after a synchronous infinite loop');
});

// The 60-call ceiling bounds a loop that would otherwise call tools forever.
test('run_code stops a runaway loop at its tool-call ceiling', async t => {
  const f = await fixture(t);
  const result = await runCode(f, `for (;;) { await tools.list_elements(); }`, { max_tool_calls: 3 });
  assert.equal(result.isError, true);
  const summary = summaryOf(result);
  assert.equal(summary.stop_reason, 'max_tool_calls');
  assert.equal(summary.completed_calls, 3);
});
