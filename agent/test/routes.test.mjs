import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RouteStore } from '../routes.mjs';
import { conditionsMatch, candidatesFor } from '../fast/task.mjs';
import { runFast } from '../fast/run.mjs';
import { recorded, settingsPhone } from './fixtures/settings-phone.mjs';

test('A repeated city label preserves the verified header when learning and reading a route', async t => {
  const sample = JSON.parse(await readFile(new URL('./fixtures/luma-route.json', import.meta.url), 'utf8'));
  sample.details = sample.details.slice(1).map(detail => ({ label: detail.value, value: '' }));
  const directory = await mkdtemp(join(tmpdir(), 'poki-route-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new RouteStore(directory);
  const context = 'Read only. Do not register, sign in, send messages, or change settings.';
  const answer = { kind: 'list', start_ref: 'e51', end_ref: 'e55', items: ['e52', 'e53', 'e54'].map(ref => ({ ref, field: 'label' })) };
  const learned = await store.learn({ ...sample, answer, context, id: 'recorded-luma-task', device: 'recorded-physical-device', verify: async () => true });
  assert.ok(learned, 'The verified city header must remain identifiable beside the city card');
  assert.equal(await store.find(sample.prompt), null, 'A route learned with initial restrictions belongs to that scope');
  assert.equal(await store.find(sample.prompt, 'Only inspect the first event'), null, 'Changed restrictions must explore again');
  const route = await store.find(sample.prompt, context);
  // An unusable cache entry must never block another learned route or a new task.
  await writeFile(join(directory, 'broken.json'), '{not JSON');
  await writeFile(join(directory, 'null.json'), 'null');
  await writeFile(join(directory, 'missing-plan.json'), JSON.stringify({
    version: 5, bundle_id: 'example.app', context, goal: [sample.prompt], texts: {},
    updatedAt: new Date().toISOString(), readout: { kind: 'action' },
  }));
  assert.equal((await store.find(sample.prompt, context)).id, route.id, 'The valid cached route must survive');
  assert.equal(await store.find('A never-before-seen task', context), null, 'Unrelated tasks must explore');
  const final = sample.trace.at(-1).result;
  assert.ok(conditionsMatch(route.plan.success, final));
  const changed = { elements: final.elements.map(e => e.label?.startsWith('Molecular World Models:')
    ? { ...e, label: 'New Astronomy Talk, Tomorrow, 18:30 GMT-8' } : e) };
  assert.ok(conditionsMatch(route.plan.success, changed), 'Navigation reaches the current result page even when its list content changes');
  const current = store.readResult(route, changed);
  assert.ok(current.summary.includes('New Astronomy Talk, Tomorrow, 18:30 GMT-8'));
  assert.ok(!current.summary.includes('Molecular World Models:'), 'Never replay the old activity name or time');
  const loading = { elements: changed.elements.map(e => e.ref === 'e52' ? { ...e, label: 'Loading' } : e) };
  assert.equal(store.readResult(route, loading), null, 'An activity without the learned time structure needs model inspection');
  const withoutHeader = { elements: final.elements.filter(e => !(e.label === '洛杉矶' && e.trait_names?.includes('Header'))) };
  assert.equal(conditionsMatch(route.plan.success, withoutHeader), false, 'A city card cannot replace the current-city header');

  const actionPrompt = 'Open the Luma Discover page.';
  await store.learn({ ...sample, details: [{ label: 'Page', value: '热门活动' }], prompt: actionPrompt, answer: { kind: 'action' }, id: 'navigation-action', device: 'recorded-physical-device', verify: async () => true });
  const action = await store.find(actionPrompt);
  assert.equal(store.readResult(action, final).success, true);
  assert.equal(store.readResult(action, withoutHeader), null, 'An action is successful only while its result conditions match');
});

test('Learned route search must not disguise filesystem failures as cache corruption', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'poki-route-read-error-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A broken symlink gives a reliable ENOENT even when the test runs as root.
  await symlink(join(directory, 'missing-target.json'), join(directory, 'unreadable.json'));
  const store = new RouteStore(directory);
  await assert.rejects(store.find('Open Settings'), { code: 'ENOENT' });
});

test('An oversized matching task never mislabels a healthy route as a broken cache file', async t => {
  const sample = JSON.parse(await readFile(new URL('./fixtures/luma-route.json', import.meta.url), 'utf8'));
  sample.details = sample.details.slice(1).map(detail => ({ label: detail.value, value: '' }));
  const directory = await mkdtemp(join(tmpdir(), 'poki-route-long-prompt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new RouteStore(directory);
  const context = 'Read only. Do not register, sign in, send messages, or change settings.';
  const answer = { kind: 'list', start_ref: 'e51', end_ref: 'e55', items: ['e52', 'e53', 'e54'].map(ref => ({ ref, field: 'label' })) };
  assert.ok(await store.learn({ ...sample, answer, context, id: 'learned-route', device: 'fixture-device', verify: async () => true }));
  assert.ok(await store.find(sample.prompt, context), 'The cached route is valid for the original task');

  const messages = [], originalError = console.error;
  console.error = message => messages.push(String(message));
  try {
    // bind() trims the task for matching, but planSchema limits goal to 2,000 characters.
    assert.equal(await store.find(sample.prompt + ' '.repeat(2001), context), null);
  } finally {
    console.error = originalError;
  }
  assert.ok(messages.some(message => message.includes('could not be reused for this task')),
    'An incompatible bound prompt should not be reported as corrupt stored data');
  assert.ok(messages.every(message => !message.includes('invalid learned-route cache')));
  assert.ok(await store.find(sample.prompt, context), 'Skipping a long prompt must not alter the healthy route');
});

test('A disabled or hidden control is never a tap candidate, whether its flag is false or 0', () => {
  const save = { label: 'Save', role: 'Button' };
  const task = { allowed: [{ id: 'save', op: 'tap', ...save }] };
  const candidates = element => candidatesFor(task, { elements: [{ ...save, ref: 'e1', ...element }] });
  assert.equal(candidates({}).length, 1, 'A control without enabled or visible flags stays tappable');
  for (const off of [false, 0]) {
    assert.deepEqual(candidates({ enabled: off, visible: true }), [], `enabled: ${off} must not be tappable`);
    assert.deepEqual(candidates({ enabled: true, visible: off }), [], `visible: ${off} must not be tappable`);
  }
});

const freeSpace = (_page, elements) => elements.map(e => e.label?.startsWith('可用容量、') ? { ...e, label: '可用容量、88.02 GB' } : e);
async function replay(store, prompt, phone) {
  const route = await store.find(prompt);
  assert.ok(route, 'The task has a learned route');
  const outcome = await runFast({ task: { ...route.plan, device: 'fixture-device', bundle_id: route.bundle_id, goal: prompt, launch_for_scope: true }, call: phone.call });
  return { outcome, result: outcome.status === 'success' ? store.readResult(route, outcome.observation) : null };
}

test('A demonstrated Settings route replays from the top of Settings after the free space changed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'poki-route-demonstration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new RouteStore(directory), demonstration = recorded.demonstration;
  assert.ok(await store.learn({ ...demonstration, id: 'demonstration', device: 'fixture-device', verify: async () => true }), 'The demonstration compiles into a route');
  const { outcome, result } = await replay(store, demonstration.prompt, settingsPhone({ edit: freeSpace }));
  assert.equal(outcome.status, 'success', outcome.handoff_reason);
  assert.deepEqual(result?.details, [{ label: '受信任证书存储区版本', value: '2026100900' }]);
});

test('A model run whose first batch missed a tap still teaches a route that replays from the top of Settings', async t => {
  for (const run of recorded.explorations) await t.test(run.name, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'poki-route-exploration-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = new RouteStore(directory);
    assert.ok(await store.learn({ ...run, id: run.name, device: 'fixture-device', verify: async () => true }), 'Only the missed tap is dropped');
    const { outcome, result } = await replay(store, run.prompt, settingsPhone({ edit: freeSpace }));
    assert.equal(outcome.status, 'success', outcome.handoff_reason);
    assert.equal(outcome.stats.model_calls, 0);
    assert.deepEqual(result?.details, run.details);
  });
});

test('A failed step is dropped only when the screen after it is the screen it failed on', async t => {
  const run = recorded.explorations.find(run => run.name === 'iOS version, first run');
  const scrolled = run.trace.findIndex(entry => entry.tool === 'scroll') + 1;
  const stale = { tool: 'tap', args: { ref: 'e1', device: 'fixture-device' }, error: true,
    result: 'Element ref is stale. Use tap_text with its label, or call list_elements again.' };
  for (const { name, trace, learned } of [
    { name: 'a stale tap that changed nothing', learned: true,
      trace: [...run.trace.slice(0, scrolled + 1), stale, run.trace[scrolled], ...run.trace.slice(scrolled + 1)] },
    { name: 'a failed scroll that still moved the page', learned: false,
      trace: run.trace.map((entry, index) => index === scrolled - 1 ? { ...entry, error: true, result: 'The scroll could not be confirmed.' } : entry) },
  ]) await t.test(name, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'poki-route-failed-step-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = new RouteStore(directory);
    const route = await store.learn({ ...run, trace, id: name, device: 'fixture-device', verify: async () => true });
    assert.equal(Boolean(route), learned);
    if (!learned) return;
    const { outcome, result } = await replay(store, run.prompt, settingsPhone({ edit: freeSpace }));
    assert.equal(outcome.status, 'success', outcome.handoff_reason);
    assert.deepEqual(result?.details, run.details);
  });
});
