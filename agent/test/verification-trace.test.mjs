import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { taskServices } from './fixtures/task-services.mjs';
import { PhoneTask } from '../task-runner.mjs';

const isVerification = request => request.tools?.some(tool => tool.name === 'report_verification');

function verifiedTrace(request) {
  for (const item of request.input) for (const part of item.content ?? []) {
    try {
      const value = JSON.parse(part.text.split('\n\n')[0]);
      if (Array.isArray(value?.trace)) return value.trace;
    } catch {}
  }
  assert.fail('The verification request carries the task trace');
}

test('A batch that fails partway gives the verifier each step it ran, the failure and the final screen', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'poki-verification-trace-'));
  const services = await taskServices(join(directory, 'mcp'), { execution: [
    ['report_plan', { title: 'Read the fixture', steps: ['Read result'], currentStep: 1 }],
    ['batch_commands', { commands: [
      { tool: 'launch_app', arguments: { bundle_id: 'org.example.channel-fixture' } },
      { tool: 'handle_alert', arguments: { action: 'accept' } },
    ] }],
    ['list_elements', {}],
    ['finish_task', { success: true, summary: 'Fixture ready.', details: [{ label: 'Status', value: 'Fixture ready.' }],
      answer: { kind: 'field', items: [{ ref: 'e1', field: 'label' }] } }],
  ] });
  const before = { ...process.env };
  Object.assign(process.env, { POKI_MCP_STATE_DIR: join(directory, 'mcp'), OPENAI_BASE_URL: services.modelURL,
    OPENAI_API_KEY: 'sk-local-channel-fixture', POKI_AGENT_AUTH: 'api-key' });
  const task = new PhoneTask('Read fixture status', 'synthetic-device', { stateDirectory: join(directory, 'state'), auth: 'api-key', model: 'gpt-5.4', stepTimeout: 10 });
  t.after(async () => {
    await task.close(); await services.close();
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
    await rm(directory, { recursive: true, force: true });
  });
  const closed = once(task, 'closed');
  void task.start();
  await closed;
  assert.equal(task.snapshot.failure, null, 'The task reached verification instead of failing setup; run with IDEVICE_TOOLS set');
  assert.deepEqual(services.deviceCalls.map(call => call.name).filter(name => ['launch_app', 'handle_alert'].includes(name)), ['launch_app', 'handle_alert'], 'Both batch steps reached the phone');

  const verification = services.modelRequests.find(isVerification);
  assert.ok(verification, 'The result was sent for verification');
  const trace = verifiedTrace(verification);
  const launch = trace.find(entry => entry.tool === 'launch_app');
  assert.equal(launch?.error, false, 'The launch that ran is in the trace as a success');
  assert.equal(launch.result.launched, true, 'The verifier sees the launch receipt');
  const alert = trace.find(entry => entry.tool === 'handle_alert');
  assert.equal(alert?.error, true, 'The failed step is in the trace as a failure');
  assert.match(JSON.stringify(alert.result), /Device locked: fixture prompt still visible/, 'The verifier sees the step error');
  const batch = trace.find(entry => entry.tool === 'batch_commands');
  assert.equal(batch?.error, true, 'The batch itself is still recorded as failed');
  assert.equal(batch.result.completed_steps, 2);
  assert.equal(batch.result.stop_reason, 'error');
  assert.equal(batch.result.failed_step.tool, 'handle_alert');
  assert.equal(batch.result.screen.elements[0].label, 'Fixture ready.', 'The verifier sees the screen the batch ended on');
  assert.ok(trace.indexOf(launch) < trace.indexOf(alert) && trace.indexOf(alert) < trace.indexOf(batch), 'Steps appear in the order they ran, then the batch outcome');
});
