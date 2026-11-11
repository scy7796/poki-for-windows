import test from 'node:test';
import assert from 'node:assert/strict';
import { reusableActionObservation } from '../post-action-observation.mjs';

function receipt() {
  const now = Date.now();
  const iso = offset => new Date(now + offset).toISOString();
  return {
    receipt_id: 'sent-1', sent: true, input_completed_at: iso(-450),
    post_action_observation: {
      version: 1, action_receipt_id: 'sent-1',
      observation: { id: 'obs-1', device: 'fixture-phone', revision: 7,
        atomic: false, structure_started_at: iso(-400), structure_completed_at: iso(-300) },
      source: 'accessibility', foreground: { bundle_id: 'org.example' },
      total: 1, truncated: false, prompt: { status: 'checked', source: 'accessibility', warning: null },
      elements: [{ ref: 'e17', role: 'Button', label: 'Open' }],
    },
  };
}
const usable = value => Boolean(reusableActionObservation(value, 'fixture-phone', 'org.example'));

test('reuses only a bound, fresh, full post-action observation', () => {
  assert.equal(usable(receipt()), true);
  assert.equal(reusableActionObservation(receipt(), 'other-device', 'org.example'), null);
  assert.equal(reusableActionObservation(receipt(), 'fixture-phone', 'other.app'), null);
});

test('rejects uncertain input, missing identity and observations captured before the action', () => {
  for (const mutate of [
    r => { r.sent = false; },
    r => { r.outcome = 'unknown'; },
    r => { r.receipt_id = 'other-receipt'; },
    r => { r.input_completed_at = new Date(Date.now() + 300).toISOString(); },
    r => { r.post_action_observation.observation.structure_started_at = 'not-a-date'; },
    r => { r.post_action_observation.observation.atomic = true; },
    r => { r.post_action_observation.observation.revision = -1; },
  ]) {
    const r = receipt(); mutate(r);
    assert.equal(usable(r), false);
  }
});

test('rejects incomplete refs, prompt warnings, inaccessible sources and stale data', () => {
  for (const mutate of [
    r => { r.post_action_observation.truncated = true; },
    r => { r.post_action_observation.total = 2; },
    r => { r.post_action_observation.elements = [{ ref: 'e1' }, { ref: 'e1' }]; r.post_action_observation.total = 2; },
    r => { r.post_action_observation.elements = [{ ref: 'bad' }]; },
    r => { r.post_action_observation.prompt.status = 'unavailable'; },
    r => { r.post_action_observation.prompt.warning = { kind: 'alert' }; },
    r => { r.post_action_observation.source = 'ocr'; },
    r => { r.post_action_observation.observation.structure_started_at = new Date(Date.now() - 40000).toISOString(); },
  ]) {
    const r = receipt(); mutate(r);
    assert.equal(usable(r), false);
  }
});

test('accepts optional screenshot only AFTER stable AX and rejects reversed order', () => {
  const r = receipt(), observation = r.post_action_observation.observation;
  const now = Date.now(), iso = offset => new Date(now + offset).toISOString();
  observation.capture_started_at = iso(-200);
  observation.capture_completed_at = iso(-100);
  r.post_action_observation.prompt.source = 'ocr';
  assert.ok(usable(r));
  observation.capture_started_at = iso(-350);
  assert.equal(usable(r), false, 'A pre-stabilization screenshot cannot authenticate a later AX tree');
});

test('model-facing action receipts exclude nested AX while retaining actual receipt fields', async () => {
  const { receiptForModel } = await import('../post-action-observation.mjs');
  const r = receipt();
  const result = receiptForModel([{ type: 'text', text: JSON.stringify(r) }]);
  const modelValue = JSON.parse(result[0].text);
  assert.equal(modelValue.post_action_observation, undefined);
  assert.equal(modelValue.sent, true);
  assert.equal(modelValue.receipt_id, r.receipt_id);
  assert.ok(r.post_action_observation.elements.length, 'The original evidence remains intact');
});
