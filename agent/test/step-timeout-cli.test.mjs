import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { taskServices } from './fixtures/task-services.mjs';
import { PhoneTask } from '../task-runner.mjs';
import { MessageRunner } from '../message-runner.mjs';
import { MessageSource } from '../message-source.mjs';
import { makeMessages } from './fixtures/messages.mjs';

test('CLI step deadline fails a pending model request without waiting for a user', { timeout: 8000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'poki-deadline-'));
  const services = await taskServices(join(dir, 'mcp'), { pendingModel: true });
  const child = spawn(process.execPath, ['agent/cli.mjs', '--device', 'synthetic-device', '--model', 'gpt-5.4', '--state', dir, '--step-timeout', '3', 'Read fixture status'], {
    cwd: new URL('../..', import.meta.url),
    env: { ...process.env, IDEVICE_TOOLS: process.execPath, POKI_MCP_STATE_DIR: join(dir, 'mcp'), OPENAI_API_KEY: 'sk-local-channel-fixture', OPENAI_BASE_URL: services.modelURL, POKI_AGENT_AUTH: 'api-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => { if (child.exitCode === null) child.kill('SIGKILL'); await exited; await services.close(); await rm(dir, { recursive: true, force: true }); });
  const [code] = await exited;
  assert.equal(code, 1, output);
  const records = await readdir(join(dir, 'tasks'));
  const record = JSON.parse(await readFile(join(dir, 'tasks', records[0]), 'utf8'));
  assert.equal(record.phase, 'failed');
  assert.equal(record.failure.code, 'step_timeout');
  assert.equal(record.metrics.steps.at(-1).endReason, 'timeout');
  assert.ok(record.metrics.steps.at(-1).elapsedMilliseconds >= 3000);
  assert.match(record.result, /timed out.*3.*second/is);
  assert.ok(!('need' in record) && !('handoff' in record));
  assert.equal(services.modelRequests.length, 1);
  assert.ok(![...(services.modelRequests[0].tools ?? []), ...services.modelRequests[0].input.filter(item => item.type === 'additional_tools').flatMap(item => item.tools ?? [])].some(tool => ['hand_to_user', 'ask_user', 'report_uncertain'].includes(tool.name)));
  assert.ok(!output.includes('"phase":"waiting"'));
});

test('Final answers survive the step deadline during verification; rejected answers resume the remaining time', { timeout: 15000 }, async t => {
  for (const mode of ['verified answer', 'rejected answer', 'verification timeout', 'final response timeout']) await t.test(mode, async t => {
    const verified = mode === 'verified answer', timedOut = mode.endsWith('timeout');
    const dir = await mkdtemp(join(tmpdir(), 'poki-answer-deadline-'));
    const reached = Promise.withResolvers(), release = Promise.withResolvers();
    const barrier = async () => {
      reached.resolve(); await release.promise; return verified;
    };
    const services = await taskServices(join(dir, 'mcp'), mode === 'final response timeout' ? { beforeFinalResponse: barrier } : { beforeVerification: barrier });
    const env = { IDEVICE_TOOLS: process.execPath, POKI_MCP_STATE_DIR: join(dir, 'mcp'), OPENAI_API_KEY: 'sk-local-channel-fixture', OPENAI_BASE_URL: services.modelURL };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const task = new PhoneTask('Fixture ready.', 'synthetic-device', { stateDirectory: dir, model: 'gpt-5.4', stepTimeout: 30, auth: 'api-key' });
    let spent = false;
    task.on('snapshot', snapshot => {
      if (snapshot.currentStep === 2 && !spent) { spent = true; t.mock.timers.tick(20000); }
    });
    const closed = once(task, 'closed');
    const finalStates = [];
    task.on('snapshot', snapshot => { if (['completed', 'failed', 'stopped'].includes(snapshot.phase)) finalStates.push(snapshot.phase); });
    t.after(async () => {
      release.resolve(); await task.close(); await services.close();
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      await rm(dir, { recursive: true, force: true });
    });
    const running = task.start();
    await reached.promise;
    t.mock.timers.tick(31000);
    assert.equal(task.finished, false, 'A submitted final answer must not be lost while verification is pending');
    if (timedOut) {
      t.mock.timers.tick(14000);
      assert.equal(task.snapshot.failure?.code, 'verification_timeout');
      assert.match(task.snapshot.result, /Fixture ready\./);
      assert.match(task.snapshot.result, /unverified/i);
      release.resolve(); await closed; await running;
      assert.deepEqual(finalStates, ['failed']);
      assert.equal(task.snapshot.execution.verifications.at(-1).status, 'unavailable');
      return;
    }
    const rejected = new Promise(resolve => task.on('snapshot', snapshot => {
      if (snapshot.execution.verification?.status === 'rejected') resolve();
    }));
    release.resolve();
    if (!verified) {
      await rejected;
      t.mock.timers.tick(10000);
      assert.equal(task.snapshot.failure?.code, 'step_timeout', 'Verification must resume the remaining ten seconds, not grant thirty more');
    }
    await closed; await running;
    assert.equal(task.snapshot.phase, verified ? 'completed' : 'failed');
    if (verified) assert.equal(task.snapshot.result, 'Fixture ready.');
    else assert.equal(task.snapshot.failure.code, 'step_timeout');
    assert.equal(task.snapshot.execution.verifications.at(-1).status, verified ? 'verified' : 'rejected');
  });
});


test('Failure claims require evidence review, one search correction at most, and the remaining step time', { timeout: 15000 }, async t => {
  const plan = ['report_plan', { title: 'Find the requested entry', steps: ['Search current page'], currentStep: 1 }];
  const failure = ['finish_task', { success: false, summary: 'The requested entry is not on this page.', details: [], answer: { kind: 'action' } }];
  const success = ['finish_task', { success: true, summary: 'Fixture ready.', details: [{ label: 'Status', value: 'Fixture ready.' }], answer: { kind: 'field', items: [{ ref: 'e1', field: 'label' }] } }];
  const scroll = ['scroll', { direction: 'down' }];
  for (const mode of ['find after correction', 'absence after bottom', 'proven inability', 'reject twice', 'failure review deadline', 'correction deadline']) await t.test(mode, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'poki-failure-review-'));
    const reached = Promise.withResolvers(), release = Promise.withResolvers();
    const correctionTimeout = mode === 'correction deadline';
    const timedOut = mode === 'failure review deadline', genuine = mode === 'proven inability';
    const repeated = mode === 'reject twice';
    const claim = genuine ? ['finish_task', { ...failure[1], summary: 'The required credential is unavailable. No saved credential or alternative authentication was found.' }] : failure;
    const execution = [plan, ['list_elements', {}], claim, null,
      ...repeated ? [failure, null] : [scroll, scroll, mode === 'find after correction' ? success : failure, null]];
    const reviews = [];
    const services = await taskServices(join(dir, 'mcp'), {
      execution,
      scrollResults: [{ sent: true, screen_change_verified: true, screen_changed: true }, { sent: true, screen_change_verified: true, screen_changed: false }],
      beforeVerification: async payload => {
        if (!payload.input.some(item => item.type === 'function_call')) {
          reviews.push(payload);
          if (correctionTimeout && reviews.length === 1) t.mock.timers.tick(20000);
        }
        if (timedOut) { reached.resolve(); await release.promise; }
        return genuine || (!repeated && reviews.length > 1);
      },
    });
    const env = { IDEVICE_TOOLS: process.execPath, POKI_MCP_STATE_DIR: join(dir, 'mcp'), OPENAI_API_KEY: 'sk-local-channel-fixture', OPENAI_BASE_URL: services.modelURL };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const task = new PhoneTask('Find the requested entry on the current page.', 'synthetic-device', { stateDirectory: dir, model: 'gpt-5.4', stepTimeout: 30, auth: 'api-key' });
    const closed = once(task, 'closed');
    let corrected = false;
    task.on('snapshot', snapshot => {
      if (correctionTimeout && snapshot.execution.failureCorrections === 1 && !corrected) {
        corrected = true;
        t.mock.timers.tick(10000);
      }
    });
    t.after(async () => {
      release.resolve(); await task.close(); await services.close();
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      await rm(dir, { recursive: true, force: true });
    });
    const running = task.start();
    if (timedOut) {
      await Promise.race([reached.promise, closed]);
      assert.equal(task.finished, false, 'Failure must enter review instead of ending immediately');
      t.mock.timers.tick(30000);
      assert.equal(task.snapshot.failure?.code, 'step_timeout', 'Failure review counts against the current step');
      release.resolve();
    }
    await closed; await running;
    assert.equal(reviews.length, genuine || timedOut || correctionTimeout ? 1 : 2, 'Failure claims must be reviewed and correction is bounded');
    const evidence = reviews.map(payload => payload.input.flatMap(item => item.content ?? []).filter(part => part.type === 'input_text').map(part => { try { return JSON.parse(part.text.split('\n\n')[0]); } catch { return null; } }).find(value => value?.claimedResult));
    assert.equal(evidence[0].claimedResult.success, false);
    assert.match(JSON.stringify(reviews[0]), /scroll down.*(?:unchanged|no longer changes)/i);
    if (timedOut || correctionTimeout) {
      assert.equal(task.snapshot.failure.code, 'step_timeout');
      return;
    }
    assert.equal(task.snapshot.phase, mode === 'find after correction' ? 'completed' : 'failed');
    if (genuine) assert.equal(task.snapshot.result, claim[1].summary, 'Evidence-backed inability remains an honest failure');
    else if (repeated) {
      assert.equal(task.snapshot.failure.code, 'failure_unverified');
      assert.notEqual(task.snapshot.result, failure[1].summary, 'Do not assert absence when the second claim is still unsupported');
    } else {
      assert.deepEqual(services.deviceCalls.filter(call => call.name === 'scroll').map(call => call.args.direction), ['down', 'down']);
      const scrollEvidence = evidence[1].trace.filter(entry => entry.tool === 'scroll');
      assert.deepEqual(scrollEvidence.map(entry => entry.result.screen_changed), [true, false]);
      assert.equal(task.snapshot.result, mode === 'find after correction' ? success[1].summary : failure[1].summary);
    }
  });
});

test('Changed scrolling survives 60 seconds, remains bounded, and timeout reaches the message channel', { timeout: 15000 }, async t => {
  for (const mode of ['scroll', 'swipe', 'unchanged', 'unverified', 'unsent', 'error', 'cap', 'hung', 'batch', 'batch unchanged']) await t.test(mode, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'poki-scroll-deadline-'));
    const success = ['scroll', 'swipe', 'batch'].includes(mode);
    const action = mode === 'swipe' ? ['swipe', { from_x: 100, from_y: 300, to_x: 100, to_y: 100 }] : ['scroll', { direction: 'down' }];
    const count = mode === 'cap' ? 9 : 4;
    let elapsed = 0;
    const services = await taskServices(join(directory, 'mcp'), {
      execution: [
        ['report_plan', { title: 'Read long list', steps: ['Find status'], currentStep: 1 }],
        ...Array.from({ length: count }, () => mode.startsWith('batch') ? ['batch_commands', { commands: [{ tool: action[0], arguments: action[1] }, { tool: 'list_elements', arguments: {} }] }] : action),
        ['finish_task', { success: true, summary: 'Fixture ready.', details: [], answer: { kind: 'field', items: [{ ref: 'e1', field: 'label' }] } }], null,
      ],
      scrollResults: Array.from({ length: count }, () => ({ sent: mode !== 'unsent', screen_change_verified: mode !== 'unverified', screen_changed: !mode.includes('unchanged'), ...(mode === 'error' ? { isError: true } : {}) })),
      beforeDeviceCall: async name => {
        if (!['scroll', 'swipe'].includes(name)) return;
        const delta = mode === 'hung' ? 60000 : 20000;
        elapsed += delta;
        t.mock.timers.tick(delta);
      },
    });
    const api = await makeMessages({ selfChat: true });
    const env = { IDEVICE_TOOLS: process.execPath, POKI_MCP_STATE_DIR: join(directory, 'mcp'), OPENAI_API_KEY: 'sk-local-channel-fixture', OPENAI_BASE_URL: services.modelURL, BLUEBUBBLES_URL: api.url, BLUEBUBBLES_PASSWORD: api.password };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const source = new MessageSource({ sender: 'allowed@example.test', chatGuid: 'any;-;allowed@example.test', stateDirectory: directory });
    const runner = new MessageRunner(source, { device: 'synthetic-device', stateDirectory: directory, model: 'gpt-5.4', stepTimeout: 60, auth: 'api-key' });
    t.after(async () => {
      await runner.close(); await services.close(); await api.close();
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      await rm(directory, { recursive: true, force: true });
    });
    await runner.receive({ id: 1, text: 'Read status from the long fixture list.' });
    await runner.finished;
    const snapshot = runner.task.snapshot;
    assert.equal(snapshot.phase, success ? 'completed' : 'failed', mode);
    if (success) assert.equal(snapshot.result, 'Fixture ready.');
    else assert.equal(snapshot.failure.code, 'step_timeout');
    const final = api.sent.filter(message => message.message === snapshot.result);
    assert.equal(final.length, 1, 'The original message channel must receive exactly one final result');
    if (!success) assert.match(final[0].message, /Failed.*timed out/is);
    const record = JSON.parse(await readFile(join(directory, 'tasks', `${snapshot.id}.json`), 'utf8'));
    assert.equal(record.phase, snapshot.phase);
    if (mode === 'cap') assert.equal(elapsed, 180000, 'Continuous progress must expire at 180 active seconds');
    if (process.env.POKI_SCROLL_EVIDENCE) await writeFile(join(process.env.POKI_SCROLL_EVIDENCE, `${mode}.json`), JSON.stringify({ mode, virtualElapsedMilliseconds: elapsed, phase: snapshot.phase, failure: snapshot.failure, steps: snapshot.metrics.steps, replies: api.sent.map(message => message.message), real: ['MessageRunner', 'PhoneTask', 'MCP transport', 'MessageSource'], fake: ['model HTTP', 'device HTTP', 'BlueBubbles HTTP', 'clock', 'list data'] }, null, 2));
  });
});
