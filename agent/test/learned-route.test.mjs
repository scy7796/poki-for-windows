import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createServer } from '../../src/tools.mjs';
import { RouteStore } from '../routes.mjs';
import { recorded, settingsPhone } from './fixtures/settings-phone.mjs';

const root = resolve(import.meta.dirname, '../..');
const app = { bundle_id: 'org.example.teach-fixture', name: 'Teach fixture', pid: 41 };
const header = label => ({ role: 'StaticText', label, trait_names: ['Header'] });
const pages = {
  Home: [header('Home'), { role: 'Button', label: 'Details' }, { role: 'Button', label: 'Other' }],
  Details: [{ role: 'Button', label: 'Home' }, header('Details'), { role: 'StaticText', label: 'Version、7.1' }],
  Other: [{ role: 'Button', label: 'Home' }, header('Other')],
};
const route = {
  version: 5, id: 'teach-fixture-route', bundle_id: app.bundle_id, goal: ['Read the fixture version'], context: '', texts: {},
  plan: {
    steps: [{ when: [header('Home')], action: { id: 'step_1', op: 'tap', label: 'Details', role: 'Button', arguments: { verify: false } },
      complete: [header('Details'), { label: 'Home', role: 'Button' }] }],
    success: [header('Details'), { label: '', role: 'StaticText', label_prefix: 'Version、', label_suffix: '' }],
  },
  readout: { kind: 'field', fields: [{ selector: { label: '', role: 'StaticText', label_prefix: 'Version、', label_suffix: '' }, field: 'label', prefix: 'Version、', title: 'Version' }] },
  planTitle: 'Read the fixture version', opening: 'Following the taught route.', sourceTask: 'teach-fixture', updatedAt: '2026-11-07T00:00:00.000Z',
};

async function phone(directory, stack) {
  const calls = [];
  let shown = [], observations = 0;
  const top = () => stack.at(-1);
  const observe = () => {
    shown = pages[top()].map((element, index) => ({ ...element, ref: `e${observations * 10 + index + 1}`, visible: true }));
    observations++;
    const now = new Date().toISOString();
    return { source: 'accessibility', truncated: false, foreground: app, elements: shown, width: 402, height: 874,
      observation: { id: `observation-${observations}`, revision: observations, device: 'synthetic-device', capture_started_at: now, capture_completed_at: now } };
  };
  const dispatch = async (name, args) => {
    calls.push(name);
    let result;
    if (name === 'poki_mcp_status') result = { connected: 1, selected: 'synthetic-device' };
    else if (name === 'get_foreground_app') result = app;
    else if (name === 'launch_app') result = { ...app, launched: true, foreground_verified: true };
    else if (['acquire_device', 'renew_device', 'release_device'].includes(name)) result = { lease_id: 'fixture-lease', device: 'synthetic-device', released: true };
    else if (['observe_device', 'list_elements'].includes(name)) result = observe();
    else if (name === 'go_back') { if (stack.length > 1) stack.pop(); result = { sent: true }; }
    else if (name === 'tap') {
      const target = shown.find(element => element.ref === args.ref);
      if (target?.role === 'Button' && pages[target.label]) stack.push(target.label);
      result = { sent: Boolean(target) };
    } else throw new Error(`Unexpected fixture device call: ${name}`);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  };
  return { calls, stack, ...await serve(directory, dispatch) };
}

async function serve(directory, dispatch) {
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer local-mcp-fixture') { res.writeHead(401).end(); return; }
    if (req.url !== '/mcp') { res.end('{}'); return; }
    const mcp = createServer(dispatch);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once('close', () => void mcp.close());
    try { await mcp.connect(transport); await transport.handleRequest(req, res); }
    catch { if (!res.headersSent) res.writeHead(500); if (!res.writableEnded) res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, 'mcp.json'), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/mcp`, token: 'local-mcp-fixture', enabled: true }), { mode: 0o600 });
  return { close: () => { server.closeAllConnections(); return new Promise(done => server.close(done)); } };
}

async function poki(directory, prompt) {
  const env = { ...process.env, IDEVICE_TOOLS: process.execPath, POKI_MCP_STATE_DIR: join(directory, 'mcp'), POKI_AGENT_AUTH: 'api-key' };
  delete env.OPENAI_API_KEY; delete env.OPENAI_BASE_URL;
  const child = spawn(join(root, 'bin/poki'), ['--device', 'synthetic-device', '--state', join(directory, 'state'), '--step-timeout', '5', prompt],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const [code] = await once(child, 'close');
  const [record] = await Promise.all((await readdir(join(directory, 'state', 'tasks'))).map(async file => JSON.parse(await readFile(join(directory, 'state', 'tasks', file), 'utf8'))));
  return { code, output, record };
}

for (const { name, stack, handoff } of [
  { name: 'A taught route runs from the poki entry with no model access', stack: ['Home'] },
  { name: 'A taught route returns to its start page when the phone was left on another page', stack: ['Home', 'Other'] },
  { name: 'A taught route that cannot reach its start fails at once when no model is available', stack: ['Other'], handoff: true },
]) test(name, { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'poki-taught-route-'));
  const device = await phone(join(directory, 'mcp'), [...stack]);
  await mkdir(join(directory, 'state', 'routes'), { recursive: true });
  await writeFile(join(directory, 'state', 'routes', 'teach-fixture-route.json'), JSON.stringify(route));
  t.after(async () => { await device.close(); await rm(directory, { recursive: true, force: true }); });
  const { code, output, record } = await poki(directory, 'Read the fixture version');
  if (handoff) {
    assert.equal(code, 1, output);
    assert.equal(record.failure.code, 'model_setup', record.result);
    assert.equal(record.execution.recovery.reason, 'step_precondition_failed');
    assert.match(record.result, /OPENAI_API_KEY|poki login/);
    assert.deepEqual(device.stack, ['Other'], 'No route action runs from a page it was not taught on');
    return;
  }
  assert.equal(code, 0, output);
  assert.equal(record.phase, 'completed', record.result);
  assert.equal(record.execution.mode, 'route');
  assert.equal(record.metrics.modelResponses, 0);
  assert.deepEqual(record.details, [{ label: 'Version', value: '7.1' }]);
  assert.deepEqual(device.stack, ['Home', 'Details']);
});

test('A route a model run taught opens Settings once and lets each next look confirm its actions', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'poki-model-route-'));
  const run = recorded.explorations.find(run => run.name === 'trust store version');
  assert.ok(await new RouteStore(join(directory, 'state', 'routes')).learn({ ...run, id: 'model-run', device: 'synthetic-device', verify: async () => true }));
  // The phone was left on About, two pages into the route, as the test iPhone reports Settings: by name, with no bundle identifier.
  const settings = settingsPhone({ open: ['top', 'scrolled', 'general', 'about'] });
  const device = await serve(join(directory, 'mcp'), (name, args) => name === 'poki_mcp_status'
    ? { content: [{ type: 'text', text: JSON.stringify({ connected: 1, selected: 'synthetic-device' }) }] } : settings.call(name, args));
  t.after(async () => { await device.close(); await rm(directory, { recursive: true, force: true }); });
  const { code, output, record } = await poki(directory, run.prompt);
  assert.equal(code, 0, output);
  assert.equal(record.execution.mode, 'route', record.result);
  assert.equal(record.metrics.modelResponses, 0);
  assert.deepEqual(record.details, run.details);
  assert.equal(settings.calls.filter(call => call.name === 'launch_app').length, 1, 'Settings is opened once');
  const inputs = settings.calls.filter(call => ['tap', 'scroll', 'swipe', 'go_back'].includes(call.name));
  assert.ok(inputs.some(call => call.name === 'go_back') && inputs.some(call => call.name === 'scroll'));
  assert.deepEqual(inputs.filter(call => call.args.verify !== false), [], 'The next observation confirms each input, so none waits for a readback');
});
