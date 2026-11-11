import test from 'node:test';
import assert from 'node:assert/strict';
import { runFast } from '../fast/run.mjs';

const text = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const stamp = offset => new Date(Date.now() + offset).toISOString();

function task() {
  return { device: 'fixture-phone', bundle_id: 'org.example', texts: {},
    steps: [{ when: [{ label: 'Open', role: 'Button' }],
      action: { id: 'tap1', op: 'tap', label: 'Open', role: 'Button', arguments: {} },
      complete: [{ label: 'Done', role: 'StaticText' }] }],
    success: [{ label: 'Done', role: 'StaticText' }] };
}
function initialObservation() {
  return { observation: { id: 'before', revision: 1, device: 'fixture-phone',
    capture_started_at: stamp(-700), capture_completed_at: stamp(-600) },
    foreground: { bundle_id: 'org.example' }, source: 'accessibility', total: 1, truncated: false,
    elements: [{ ref: 'e1', label: 'Open', role: 'Button', enabled: true, visible: true }] };
}
function finalObservation() {
  return { observation: { id: 'after', revision: 2, device: 'fixture-phone', atomic: false,
    structure_started_at: stamp(-250), structure_completed_at: stamp(-200), capture_started_at: stamp(-150), capture_completed_at: stamp(-100) },
    foreground: { bundle_id: 'org.example' }, source: 'accessibility', total: 1, truncated: false,
    prompt: { status: 'checked', source: 'ocr', warning: null },
    elements: [{ ref: 'e2', label: 'Done', role: 'StaticText', enabled: true, visible: true }] };
}
async function execute(allowReuse) {
  const calls = [];
  const call = async (name, args) => {
    calls.push({ name, args });
    if (name === 'acquire_device') return text({ lease_id: 'lease', device: 'fixture-phone' });
    if (name === 'renew_device') return text({ renewed: true });
    if (name === 'release_device') return text({ released: true });
    if (name === 'get_foreground_app') return text({ bundle_id: 'org.example' });
    if (name === 'observe_device') return text(calls.filter(c => c.name === 'observe_device').length === 1
      ? initialObservation() : finalObservation());
    if (name === 'tap') return text({ sent: true, receipt_id: 'receipt-1', input_completed_at: stamp(-350),
      post_action_observation: { version: 1, action_receipt_id: 'receipt-1', ...finalObservation(),
        prompt: { status: allowReuse ? 'checked' : 'unavailable', source: 'ocr', warning: null } } });
    throw new Error('Unexpected fixture call ' + name);
  };
  return { outcome: await runFast({ task: task(), call }), calls };
}
test('fast route reuses one eligible post-action observation for its next step', async () => {
  const { outcome, calls } = await execute(true);
  assert.equal(outcome.status, 'success');
  assert.equal(outcome.stats.action_count, 1);
  assert.equal(calls.filter(c => c.name === 'observe_device').length, 1);
  assert.equal(calls.find(c => c.name === 'tap').args.return_observation, true);
  assert.equal(calls.find(c => c.name === 'tap').args.post_action_ocr, true);
});
test('fast route falls back to real observation when a prompt check is unavailable', async () => {
  const { outcome, calls } = await execute(false);
  assert.equal(outcome.status, 'success');
  const reads = calls.filter(c => c.name === 'observe_device');
  assert.equal(reads.length, 2);
  assert.ok(reads.every(c => c.args.include_image === false));
});
