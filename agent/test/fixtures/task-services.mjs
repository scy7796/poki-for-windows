import http from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createServer } from '../../../src/tools.mjs';
import { runBatch } from '../../../src/batch.mjs';

function respond(res, tool, index, opening, finalText = 'Finished the local fixture task.') {
  const item = tool ? { type: 'function_call', id: `fc_${index}`, call_id: `call_${index}`, name: tool[0],
    arguments: JSON.stringify(tool[1]), status: 'completed' }
    : { type: 'message', id: `msg_${index}`, role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: finalText, annotations: [] }] };
  const output = opening ? [{ type: 'message', id: `msg_opening_${index}`, role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: opening, annotations: [] }] }, item] : [item];
  const result = { id: `resp_${index}`, object: 'response', status: 'completed', model: 'gpt-5.4', service_tier: 'default', output,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [
    { type: 'response.created', response: { ...result, status: 'in_progress', output: [] } },
    ...output.flatMap((item, output_index) => [
      { type: 'response.output_item.added', output_index, item },
      { type: 'response.output_item.done', output_index, item },
    ]),
    { type: 'response.completed', response: result },
  ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}

export async function taskServices(directory, { route = false, appSearch = false, pendingModel = false, beforeVerification, beforeFinalResponse, execution, scrollResults = [], beforeDeviceCall, devices = [], postActionObservation = false } = {}) {
  const fixture = { modelRequests: [], deviceCalls: [], events: [], foreground: { bundle_id: 'org.example.channel-fixture', name: 'Channel fixture' }, value: '', observations: 0 };
  let executionIndex = 0, scrollIndex = 0;
  const model = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer sk-local-channel-fixture') { res.writeHead(401).end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw);
    fixture.modelRequests.push(payload);
    if (pendingModel) return;
    const prompt = payload.input.find(item => item.role === 'user')?.content?.find(part => part.type === 'input_text')?.text?.split('\n\n')[0] ?? '';
    if (route && !payload.tools?.length) {
      respond(res, null, fixture.modelRequests.length, undefined, JSON.stringify({ complete: true, items: [{ ref: 'e2', field: 'label' }] }));
      return;
    }
    const value = prompt.match(/[“"]([^”"]+)[”"]/)?.[1];
    const calls = payload.input.filter(item => item.type === 'function_call');
    const verification = payload.tools.some(tool => tool.name === 'report_verification');
    const verified = verification && beforeVerification ? await beforeVerification(payload) : true;
    const failed = JSON.stringify(payload.input).includes('FAIL_CHANNEL_TASK');
    const simple = payload.input.some(item => item.role === 'user' && item.content?.some(part => part.text?.split('\n\n')[0] === 'Fixture ready.'));
    const plan = ['report_plan', { title: 'Local fixture task', steps: ['Prepare', 'Read result'], currentStep: 1 }];
    const sequence = verification ? [['report_verification', { verified, reason: 'The synthetic fixture observation says Fixture ready.' }]]
      : route ? [plan,
          ...(appSearch ? [['list_apps', { query: 'Channel fixture', include_system: true }], ['list_apps', { query: 'does-not-exist' }]] : []),
          ['launch_app', { bundle_id: 'org.example.channel-fixture' }],
          ['list_elements', {}],
          ['fill', { field: 'Value', text: value, submit: false }],
          ['list_elements', {}],
          ['finish_task', { success: true, summary: `Saved: ${value}`, details: [{ label: 'Stored', value: `Saved: ${value}` }], answer: { kind: 'field', items: [{ ref: 'e2', field: 'label', prefix: 'Saved: ' }] } }],
        ]
      : failed ? [plan, ['finish_task', { success: false, summary: 'Synthetic failure returned to the original chat.', details: [], answer: { kind: 'action' } }]]
        : [plan,
          ['report_plan', { title: 'Local fixture task', steps: ['Prepare', 'Read result'], currentStep: 2 }],
          ['launch_app', { bundle_id: 'org.example.channel-fixture' }],
          ...simple ? [] : [['handle_alert', { action: 'accept' }]],
          ['list_elements', {}],
          ['finish_task', { success: true, summary: 'Fixture ready.', details: [{ label: 'Status', value: 'Fixture ready.' }], answer: { kind: 'field', items: [{ ref: 'e1', field: 'label' }] } }],
        ];
    if (execution && !verification) {
      respond(res, execution[executionIndex++], fixture.modelRequests.length);
      return;
    }
    const opening = calls.length || verification || failed || value === 'Elm' ? undefined
      : route ? `好，我去测试App里填入“${value}”。`
      : simple ? "I'll check the fixture's current status. This second sentence must not be sent."
      : "I'll check the fixture status after the synthetic sign-in.";
    if (!verification && !sequence[calls.length]) await beforeFinalResponse?.();
    respond(res, sequence[calls.length], fixture.modelRequests.length, opening);
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  fixture.modelURL = `http://127.0.0.1:${model.address().port}/v1`;
  const active = new Set();
  const phone = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer local-mcp-fixture') { res.writeHead(401).end(); return; }
    if (req.url === '/session/close' || req.url === '/request/cancel') { fixture.events.push({ type: req.url, foreground: fixture.foreground }); res.end('{}'); return; }
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    const dispatch = async (name, args) => {
      if (name === 'batch_commands') return runBatch({ dispatch, readback: async () => ({ screen: JSON.parse((await dispatch('list_elements', {})).content[0].text) }) }, args);
      fixture.deviceCalls.push({ name, args });
      fixture.events.push({ type: name, foreground: fixture.foreground });
      await beforeDeviceCall?.(name, args);
      let result;
      if (name === 'poki_mcp_status') result = { connected: 1, selected: 'synthetic-device' };
      else if (name === 'list_devices') result = { devices };
      else if (name === 'list_apps') result = { apps: [{ name: 'Channel fixture', bundle_id: 'org.example.channel-fixture', path: '/large/private/path', metadata: 'x'.repeat(2000) }, ...Array.from({ length: 400 }, (_, index) => ({ name: `Unused fixture app ${index}`, bundle_id: `org.example.unused-${index}`, metadata: 'x'.repeat(200) }))] };
      else if (name === 'get_foreground_app') {
        result = fixture.foregroundError ? { isError: true, error: 'Synthetic foreground unavailable' } : fixture.foreground;
        fixture.foregroundError = false;
      }
      else if (name === 'launch_app') {
        if (args.name !== undefined && !args.name.trim()) result = { isError: true, error: 'Multiple installed apps match' };
        else if (fixture.restoreError && args.bundle_id !== 'org.example.channel-fixture') result = { isError: true, error: 'Synthetic restore failure' };
        else { fixture.foreground = args.name ? fixture.namedApps[args.name] : { bundle_id: args.bundle_id, pid: 100, name: 'Channel fixture' }; result = { launched: true, foreground_verified: true, ...fixture.foreground }; }
      }
      else if (name === 'press_key' && args.key === 'home') result = { sent: true };
      else if (name === 'press_button' && args.button === 'home') { fixture.foreground = fixture.homeForeground ?? { bundle_id: 'com.apple.springboard', name: 'SpringBoard' }; result = { sent: true }; }
      else if (route && ['acquire_device', 'renew_device', 'release_device'].includes(name)) result = { lease_id: 'fixture-lease', device: 'synthetic-device', released: true };
      else if (route && name === 'fill') {
        fixture.value = args.text;
        result = { sent: true, screen: { foreground: fixture.foreground.name } };
        if (postActionObservation && args.return_observation === true) {
          const at = offset => new Date(Date.now() + offset).toISOString();
          result = { ...result, receipt_id: 'fixture-fill-receipt', input_completed_at: at(-350),
            post_action_observation: { version: 1, action_receipt_id: 'fixture-fill-receipt',
              observation: { id: 'fixture-after-fill', device: 'synthetic-device', revision: 2, atomic: false,
                structure_started_at: at(-300), structure_completed_at: at(-200) },
              source: 'accessibility', foreground: fixture.foreground, truncated: false,
              prompt: { status: 'checked', source: 'accessibility', warning: null }, total: 2,
              elements: [
                { ref: 'e3', identifier: 'fixture-value', label: 'Value', value: fixture.value, role: 'TextField', visible: true },
                { ref: 'e4', identifier: 'fixture-saved', label: 'Saved: ' + fixture.value, role: 'StaticText', visible: true },
              ] } };
        }
      }
      else if (route && ['list_elements', 'observe_device'].includes(name)) result = {
        source: 'accessibility', truncated: false, foreground: fixture.foreground,
        observation: { id: `observation-${++fixture.observations}`, revision: fixture.observations, device: 'synthetic-device', capture_started_at: new Date().toISOString(), capture_completed_at: new Date().toISOString() },
        elements: [
          { ref: 'e1', identifier: 'fixture-value', label: 'Value', value: fixture.value, role: 'TextField', visible: true },
          { ref: 'e2', identifier: 'fixture-saved', label: `Saved: ${fixture.value}`, role: 'StaticText', visible: true },
        ],
      };
      else if (['scroll', 'swipe'].includes(name) && scrollResults[scrollIndex]) result = scrollResults[scrollIndex++];
      else if (name === 'handle_alert') result = { isError: true, error: 'Device locked: fixture prompt still visible. Inspect and choose another approach.' };
      else if (name === 'list_elements') result = { foreground: fixture.foreground, elements: [{ ref: 'e1', label: 'Fixture ready.', value: 'Fixture ready.', role: 'text' }] };
      else throw new Error(`Unexpected fixture device call: ${name}`);
      return { ...(result.isError ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(result) }] };
    };
    const server = createServer(dispatch);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    active.add(server);
    res.once('close', () => { active.delete(server); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res); }
    catch { if (!res.headersSent) res.writeHead(500); if (!res.writableEnded) res.end(); }
  });
  phone.listen(0, '127.0.0.1'); await once(phone, 'listening');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, 'mcp.json'), JSON.stringify({ url: `http://127.0.0.1:${phone.address().port}/mcp`, token: 'local-mcp-fixture', enabled: true }), { mode: 0o600 });
  fixture.close = async () => {
    await Promise.allSettled([...active].map(server => server.close()));
    await Promise.all([phone, model].map(server => {
      server.closeAllConnections(); return new Promise(resolve => server.close(resolve));
    }));
  };
  return fixture;
}
