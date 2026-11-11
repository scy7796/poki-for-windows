import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeMessages, addMessage } from './fixtures/messages.mjs';
import { taskServices } from './fixtures/task-services.mjs';
import { runnerFixture } from './fixtures/runner.mjs';

test('Delayed openings preserve replies for new and reused tasks', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'poki-opening-'));
  const state = join(directory, 'state');
  const services = await taskServices(join(directory, 'mcp'), { route: true, appSearch: true });
  const messageTimes = [];
  const api = await makeMessages({ selfChat: true });
  const scenarios = [
    { prompt: '在测试App里填入“Cedar”。', opening: '我会在测试App里填入“Cedar”。', result: 'Saved: Cedar', calls: 11, mode: 'explore' },
    { prompt: '在测试App里填入“Birch”。', opening: '我会在测试App里填入“Birch”。', result: 'Saved: Birch', calls: 0, mode: 'route' },
    { prompt: '在测试App里填入“Maple”。', opening: '我会在测试App里填入“Maple”。', result: 'Saved: Maple', calls: 0, mode: 'route' },
    { prompt: '在测试App里写入“Elm”。', opening: '我会在测试App里写入“Elm”。', result: 'Saved: Elm', calls: 11, mode: 'explore' },
  ];
  const config = join(directory, 'config.json');
  await writeFile(config, JSON.stringify({ sender: 'allowed@example.test', chatGuid: 'any;-;allowed@example.test',
    device: 'synthetic-device', model: 'gpt-5.4', auth: 'api-key' }));
  const env = { ...process.env, IDEVICE_TOOLS: process.execPath, OPENAI_API_KEY: 'sk-local-channel-fixture', OPENAI_BASE_URL: services.modelURL,
    POKI_MCP_STATE_DIR: join(directory, 'mcp'), BLUEBUBBLES_URL: api.url, BLUEBUBBLES_PASSWORD: api.password };
  delete env.POKI_AGENT_SERVICE_TIER;
  delete env.POKI_AGENT_STEP_TIMEOUT;
  const child = spawn(process.execPath, ['agent/imessage.mjs', '--config', config, '--state', state],
    { cwd: resolve(import.meta.dirname, '../..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let transcript = '', started = false, index = 0, modelBaseline = 0, deviceBaseline = 0, failure;
  let handling = Promise.resolve();
  const replies = [], records = [], openings = [];
  const deviceCount = () => services.deviceCalls.filter(call => call.name !== 'poki_mcp_status').length;
  const addTask = () => {
    const text = scenarios[index].prompt;
    messageTimes.push(performance.now());
    addMessage(api, text, { outgoing: 1, reaction: null });
    addMessage(api, text, { reaction: null });
  };
  const receive = data => {
    transcript += data;
    if (!started && transcript.includes('ready. Only new messages')) { started = true; addTask(); }
  };
  child.stdout.on('data', receive); child.stderr.on('data', receive);
  api.on('reply', text => {
    const observed = { text, messageToReplyMilliseconds: performance.now() - messageTimes[index], deviceCalls: deviceCount(), modelCalls: services.modelRequests.length };
    handling = handling.then(async () => {
      const scenario = scenarios[index];
      replies.push(text);
      if (replies.length % 2 === 1) {
        assert.equal(text, scenario.opening);
        assert.ok(observed.deviceCalls > deviceBaseline, 'Device work starts while the opening is waiting');
        assert.ok(observed.messageToReplyMilliseconds >= 1500, 'Opening delivery is delayed');
        openings.push(observed);
        return;
      }
      assert.equal(text, scenario.result);
      const names = await readdir(join(state, 'tasks'));
      const all = await Promise.all(names.map(async name => JSON.parse(await readFile(join(state, 'tasks', name), 'utf8'))));
      assert.equal(all.length, index + 1, 'Synchronized replies must not create extra tasks');
      const record = all.find(record => record.prompt === scenario.prompt);
      assert.equal(record.phase, 'completed', record.result);
      assert.equal(record.stepTimeoutSeconds, 60);
      assert.equal(record.opening, scenario.opening);
      assert.equal(record.execution.mode, scenario.mode);
      assert.equal(services.modelRequests.length - modelBaseline, scenario.calls);
      assert.ok(services.modelRequests.every(request => request.reasoning?.effort === 'low'));
      const searchReplies = services.modelRequests.flatMap(request => request.input.filter(item => item.type === 'function_call_output'))
        .map(item => item.output).filter(output => typeof output === 'string' && output.includes('"apps":'));
      assert.ok(searchReplies.length > 0);
      assert.ok(searchReplies.every(output => output.length < 2000 && !output.includes('Unused fixture app')),
        'The model must see only compact matches, never the complete app directory');
      assert.equal(record.metrics.modelResponses + (record.metrics.verificationResponses ?? 0), scenario.calls);
      records.push(record);
      if (index === 0) {
        assert.ok(record.execution.learned);
        const route = JSON.parse(await readFile(record.execution.learned.path, 'utf8'));
        assert.equal(route.opening, '我会在测试App里填入“{{text_1}}”。');
      }
      if (index === 1) {
        const path = records[0].execution.learned.path;
        const route = JSON.parse(await readFile(path, 'utf8'));
        delete route.opening;
        await writeFile(path, JSON.stringify(route));
      }
      modelBaseline = services.modelRequests.length;
      deviceBaseline = deviceCount();
      index++;
      if (index === scenarios.length) child.kill('SIGTERM'); else addTask();
    }).catch(error => { failure ??= error; child.kill('SIGTERM'); });
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited; await handling;
    await api.close(); await services.close();
    if (process.env.POKI_CHANNEL_EVIDENCE) {
      const evidence = join(resolve(process.env.POKI_CHANNEL_EVIDENCE), 'natural-opening');
      await mkdir(evidence, { recursive: true });
      await writeFile(join(evidence, 'worker-terminal.txt'), transcript);
      await writeFile(join(evidence, 'opening-and-task-evidence.json'), JSON.stringify({
        real: ['channel CLI', 'PhoneTask', 'pi SDK', 'RouteStore', 'MCP stdio'],
        fake: ['BlueBubbles HTTP API', 'model HTTP API', 'device service and test data'],
        scenarios, replies, openings, records, modelRequests: services.modelRequests, deviceCalls: services.deviceCalls,
      }, null, 2));
    }
    await rm(directory, { recursive: true, force: true });
  });
  const [code, signal] = await exited;
  await handling;
  if (failure) throw failure;
  assert.equal(code, 0, `${signal}\n${transcript}`);
  assert.equal(index, scenarios.length);
  assert.deepEqual(replies, scenarios.flatMap(scenario => [scenario.opening, scenario.result]));
});

test('Results are delivered before returning to the original foreground and releasing the device', { timeout: 30000 }, async t => {
  const { runner, services, source } = await runnerFixture(t);
  const scenarios = [
    { app: 'com.apple.MobileSMS', value: 'Cedar', mode: 'explore', requests: 9 },
    { app: 'com.apple.mobilenotes', value: 'Birch', mode: 'route', requests: 0 },
    { app: null, name: ' ', pid: 37, home: true, value: 'Maple', mode: 'route', requests: 0 },
    { app: null, name: '', pid: 37, home: true, value: 'Elm', mode: 'route', requests: 0 },
    { app: null, name: ' ', pid: 37, home: true, homeMismatch: true, value: 'Fir', mode: 'route', requests: 0 },
    { app: 'com.apple.MobileSMS', value: 'Ash', mode: 'route', requests: 0, userSwitch: true },
    { app: 'com.apple.MobileSMS', value: 'Oak', mode: 'route', requests: 0, restoreError: true },
    { app: null, value: 'Willow', mode: 'route', requests: 0 },
    { app: 'com.apple.MobileSMS', value: 'Pine', mode: 'route', requests: 0, foregroundError: true },
  ];
  const evidence = [];
  for (const scenario of scenarios) {
    services.foreground = { bundle_id: scenario.app, pid: scenario.pid ?? 40, name: scenario.name ?? 'Original fixture app' };
    services.homeForeground = scenario.home ? { ...services.foreground, pid: scenario.homeMismatch ? 38 : 37 } : undefined;
    services.restoreError = scenario.restoreError;
    services.foregroundError = scenario.foregroundError;
    services.namedApps = { 'Original fixture app': services.foreground };
    services.events.length = 0;
    const baseline = services.modelRequests.length;
    const send = source.send;
    source.send = async (text, metadata) => {
      await send(text, metadata);
      if (scenario.userSwitch && metadata?.kind === 'final') services.foreground = { bundle_id: 'org.example.user-choice', pid: 60 };
    };
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await runner.receive({ id: scenario.value, text: `在测试App里填入“${scenario.value}”。` });
    await Promise.resolve();
    t.mock.timers.tick(3000);
    await runner.finished;
    t.mock.timers.reset();
    source.send = send;
    const expected = scenario.userSwitch ? 'org.example.user-choice' : scenario.restoreError || scenario.foregroundError ? 'org.example.channel-fixture' : scenario.app;
    assert.equal(services.foreground.bundle_id, expected, scenario.value);
    if (scenario.home && !scenario.homeMismatch) assert.equal(services.foreground.pid, 37, 'Home returns to the original desktop process');
    assert.equal(runner.task.snapshot.phase, 'completed');
    assert.equal(runner.task.snapshot.result, `Saved: ${scenario.value}`);
    assert.equal(runner.task.snapshot.execution.mode, scenario.mode);
    assert.equal(services.modelRequests.length - baseline, scenario.requests, 'Restoration adds no model requests');
    const delivered = services.events.findIndex(event => event.type === 'delivered');
    const closed = services.events.findIndex(event => event.type === '/session/close');
    assert.ok(delivered >= 0 && closed > delivered, 'The result must arrive before releasing the session');
    if (scenario.mode === 'route') assert.ok(services.events.findIndex(event => event.type === 'release_device') > delivered, 'Route lease remains held through delivery');
    if (!scenario.userSwitch && !scenario.restoreError && !scenario.foregroundError) assert.equal(services.events[closed].foreground.bundle_id, scenario.app);
    if (scenario.restoreError || scenario.foregroundError || scenario.homeMismatch) assert.match(runner.task.snapshot.warning, /restore/i);
    else assert.doesNotMatch(runner.task.snapshot.warning ?? '', /restore/i);
    evidence.push({ scenario, final: services.foreground, events: [...services.events], metrics: runner.task.snapshot.metrics });
  }
  if (process.env.POKI_CHANNEL_EVIDENCE) {
    await mkdir(process.env.POKI_CHANNEL_EVIDENCE, { recursive: true });
    await writeFile(join(process.env.POKI_CHANNEL_EVIDENCE, 'foreground-return.json'), JSON.stringify(evidence, null, 2));
  }
});

test('Both channels delay only opening delivery and preserve opening-before-result order', { timeout: 30000 }, async t => {
  for (const [style, random, delay] of [['opening', 0, 1500], [undefined, 1, 3000]]) {
    await t.test(style ?? 'telegram', async t => {
      const { runner, source, replies, services } = await runnerFixture(t);
      source.progressStyle = style;
      t.mock.method(Math, 'random', () => random);
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const receiving = runner.receive({ id: 'delayed', text: '在测试App里填入“Cedar”。' });
      await receiving;
      assert.deepEqual(replies, [], 'No opening is sent synchronously');
      const terminal = new Promise(resolve => runner.task.on('snapshot', snapshot => { if (['completed', 'failed'].includes(snapshot.phase)) resolve(); }));
      await terminal;
      assert.equal(services.modelRequests.length, 9, 'The task finishes while the opening delay is pending');
      assert.deepEqual(replies, []);
      const total = runner.task.snapshot.metrics.totalMilliseconds;
      t.mock.timers.tick(delay - 1);
      await Promise.resolve();
      assert.deepEqual(replies, []);
      t.mock.timers.tick(1);
      await runner.finished;
      assert.ok(replies[0].includes('Cedar'));
      assert.equal(replies.at(-1), style === 'opening' ? 'Saved: Cedar' : 'completed: Saved: Cedar');
      assert.equal(runner.task.snapshot.metrics.totalMilliseconds, total, 'Delivery waiting does not change task duration');
    });
  }
});
