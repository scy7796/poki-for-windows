import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { taskServices } from './fixtures/task-services.mjs';
import { PhoneTask } from '../task-runner.mjs';

async function scenario(t, postActionObservation) {
  const directory = await mkdtemp(join(tmpdir(), 'poki-reuse-'));
  const services = await taskServices(join(directory, 'mcp'), { route: true, postActionObservation, execution: [
    ['report_plan', { title: 'Write fixture', steps: ['Open app', 'Fill field'], currentStep: 1 }],
    ['launch_app', { bundle_id: 'org.example.channel-fixture' }],
    ['report_plan', { title: 'Write fixture', steps: ['Open app', 'Fill field'], currentStep: 2 }],
    ['fill', { field: 'Value', text: 'Example', submit: false }],
    ['finish_task', { success: true, summary: 'Saved: Example',
      details: [{ label: 'Value', value: 'Example' }], answer: { kind: 'action' } }],
  ] });
  const env = { ...process.env };
  Object.assign(process.env, { IDEVICE_TOOLS: process.execPath, POKI_MCP_STATE_DIR: join(directory, 'mcp'),
    OPENAI_BASE_URL: services.modelURL, OPENAI_API_KEY: 'sk-local-channel-fixture', POKI_AGENT_AUTH: 'api-key' });
  const task = new PhoneTask('Fill the fixture field with Example', 'synthetic-device',
    { stateDirectory: join(directory, 'state'), auth: 'api-key', model: 'gpt-5.4', stepTimeout: 10 });
  t.after(async () => {
    await task.close(); await services.close();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await rm(directory, { recursive: true, force: true });
  });
  const closed = once(task, 'closed');
  void task.start(); await closed;
  assert.equal(task.snapshot.failure, null, 'The synthetic task must complete verification');
  return { listCalls: services.deviceCalls.filter(c => c.name === 'list_elements').length,
    trace: task.trace, deviceCalls: services.deviceCalls, modelRequests: services.modelRequests };
}

test('Agent reuses eligible receipt and omits the second explicit list_elements read', { timeout: 60000 }, async t => {
  const reused = await scenario(t, true);
  assert.equal(reused.listCalls, 1);
  assert.ok(reused.trace.some(e => e.tool === 'post_action_observation' && e.reused && e.args.source === 'action_receipt'));
  assert.equal(reused.deviceCalls.find(c => c.name === 'fill').args.return_observation, true);
  assert.equal(reused.deviceCalls.find(c => c.name === 'fill').args.post_action_ocr, undefined,
    'Ordinary Agent must not add image/OCR work by default');
  const toolOutputs = reused.modelRequests
    .filter(request => !request.tools?.some(tool => tool.name === 'report_verification'))
    .flatMap(request => request.input.filter(item => item.type === 'function_call_output'));
  assert.ok(toolOutputs.length, 'The Agent sent execution tool outputs to the model');
  assert.ok(toolOutputs.every(item => !JSON.stringify(item.output).includes('post_action_observation')),
    'The model must receive one trimmed element list, not the nested receipt and a duplicate');
});
test('Agent retains list_elements fallback for a legacy receipt', { timeout: 60000 }, async t => {
  const legacy = await scenario(t, false);
  assert.equal(legacy.listCalls, 2);
  assert.ok(!legacy.trace.some(e => e.tool === 'post_action_observation'));
});
