import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, value } from './fixture.mjs';
import sharp from 'sharp';
import { readScreen } from '../src/interaction.mjs';

test('opted-in input supplies post-action refs without an extra observation request', async t => {
  const f = await fixture(t);
  const response = await f.call('press_key', { key: 'return', return_observation: true });
  assert.ok(!response.isError);
  const receipt = value(response);
  assert.equal(receipt.sent, true);
  assert.equal(receipt.post_action_observation?.version, 1);
  assert.equal(receipt.post_action_observation?.action_receipt_id, receipt.receipt_id);
  assert.ok(receipt.post_action_observation.observation.structure_started_at >= receipt.input_completed_at);
  assert.equal(receipt.post_action_observation.observation.capture_started_at, undefined,
    'AX-only reuse must not fabricate image capture timestamps');
  assert.equal(receipt.post_action_observation.prompt.source, 'accessibility');
  assert.ok(receipt.post_action_observation.elements.every(e => /^e\d+$/.test(e.ref)));
  assert.equal(receipt.post_action_observation.prompt.status, 'checked');
});

test('optional image OCR captures AFTER the stable AX read', async t => {
  const f = await fixture(t);
  const result = await f.call('press_key', { key: 'return', return_observation: true, post_action_ocr: true });
  assert.ok(!result.isError);
  const value = JSON.parse(result.content.find(item => item.type === 'text').text);
  const data = value.post_action_observation;
  assert.equal(data.prompt.status, 'checked');
  assert.equal(data.prompt.source, 'ocr');
  assert.ok(data.observation.structure_completed_at <= data.observation.capture_started_at,
    'The screenshot must follow AX stabilization');
  assert.ok(data.observation.capture_started_at <= data.observation.capture_completed_at);
});

test('an AX-only ref remains usable without a redundant capture until input invalidates it', async t => {
  const f = await fixture(t);
  // A full-screen AX root makes orientation verifiable without a screenshot.
  await f.set({ elements: [
    { role: 'Application', label: 'Fixture', frame: { x: 0, y: 0, width: 100, height: 200 } },
    { role: 'Button', label: 'Continue', frame: { x: 10, y: 10, width: 40, height: 20 } },
  ] });
  const result = await f.call('press_key', { key: 'return', return_observation: true });
  const receipt = value(result);
  const ref = receipt.post_action_observation?.elements?.find(e => e.role === 'Button')?.ref
    ?? receipt.post_action_observation?.elements?.[0]?.ref;
  assert.match(ref, /^e\d+$/);
  const tapped = await f.call('tap', { ref });
  assert.ok(!tapped.isError, 'Current action-bound AX refs must remain valid without an extra list_elements read');
});

test('a changed post-input image does not invalidate stable AX simply because the scene revision advances', async t => {
  const f = await fixture(t);
  // Establish a previous image, then supply a different image for the
  // post-action capture. observeFrame() is expected to advance its revision.
  const before = value(await f.call('take_screenshot'));
  await sharp({ create: { width: 100, height: 200, channels: 3, background: '#d31f43' } })
    .png().toFile(f.image);
  const response = await f.call('press_key', { key: 'return', return_observation: true, post_action_ocr: true });
  assert.ok(!response.isError);
  const after = value(response).post_action_observation;
  assert.ok(after, 'Expected post-input image changes must not masquerade as an intervening input');
  assert.ok(after.observation.revision > before.observation.revision);
  assert.ok(after.observation.structure_completed_at <= after.observation.capture_started_at);
});

test('rotation between coordinate taps refreshes viewport before HID conversion', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const ax = (width, height) => ({ elements: [
    { role: 'Application', label: 'Fixture', frame: { x: 0, y: 0, width, height } },
    { role: 'Button', label: 'Go', frame: { x: 10, y: 10, width: 40, height: 20 } },
  ] });
  await f.set(ax(100, 200));
  const first = await f.call('tap', { x: 80, y: 170, return_observation: true });
  assert.ok(!first.isError, 'Portrait tap is sent successfully');

  // Rotate outside Poki. The previous AX-only observation is still bound
  // to the portrait frame, but the next pre-input AX root is landscape.
  await sharp({ create: { width: 200, height: 100, channels: 3, background: 'white' } })
    .png().toFile(f.image);
  await f.set(ax(200, 100));
  const second = await f.call('tap', { x: 180, y: 60, return_observation: true });
  assert.ok(!second.isError, 'A landscape tap must not use stale portrait dimensions');

  const taps = (await f.events()).filter(e => e.op === 'tap');
  assert.equal(taps.length, 2);
  const actual = taps[1].request;
  const expected = [Math.round(180 / 199 * 65535), Math.round(60 / 99 * 65535)];
  assert.deepEqual([actual.x, actual.y], expected,
    'Coordinate conversion must use the newly captured 200×100 viewport');
});

test('unverifiable AX root safely falls back to capture for coordinate taps', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  // No full-screen root means the AX-only observation cannot establish orientation.
  await f.set({ elements: [{ role: 'Button', label: 'Go', frame: { x: 10, y: 10, width: 40, height: 20 } }] });
  assert.ok(!(await f.call('tap', { x: 80, y: 170, return_observation: true })).isError);
  await sharp({ create: { width: 200, height: 100, channels: 3, background: 'white' } })
    .png().toFile(f.image);
  assert.ok(!(await f.call('tap', { x: 180, y: 60, return_observation: true })).isError,
    'Do not trust an AX-only viewport when there is no verifiable root frame');
  const taps = (await f.events()).filter(e => e.op === 'tap');
  assert.deepEqual([taps.at(-1).request.x, taps.at(-1).request.y],
    [Math.round(180 / 199 * 65535), Math.round(60 / 99 * 65535)]);
});

test('verify:false coordinate tap refreshes dimensions after rotation', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const ax = (width, height) => ({ elements: [
    { role: 'Application', label: 'Fixture', frame: { x: 0, y: 0, width, height } },
    { role: 'Button', label: 'Go', frame: { x: 10, y: 10, width: 40, height: 20 } },
  ] });
  await f.set(ax(100, 200));
  const first = await f.call('tap', { x: 80, y: 170, return_observation: true });
  assert.ok(!first.isError);
  assert.ok(value(first).post_action_observation, 'Create the AX-only viewport binding first');

  // The phone rotates outside Poki. verify:false bypasses the pre-input AX
  // read, so the cached portrait viewport must not be used for conversion.
  await sharp({ create: { width: 200, height: 100, channels: 3, background: 'white' } })
    .png().toFile(f.image);
  await f.set(ax(200, 100));
  const second = await f.call('tap', { x: 180, y: 60, verify: false });
  assert.ok(!second.isError);
  assert.equal(value(second).verified, false);
  const taps = (await f.events()).filter(e => e.op === 'tap');
  assert.equal(taps.length, 2);
  assert.deepEqual([taps[1].request.x, taps[1].request.y],
    [Math.round(180 / 199 * 65535), Math.round(60 / 99 * 65535)],
    'Even without AX verification, the second tap must use landscape dimensions');
});


for (const [name, command] of [
  ['swipe', { tool: 'swipe', arguments: { from_x: 90, from_y: 60, to_x: 10, to_y: 60 } }],
  ['drag', { tool: 'drag', arguments: { from_x: 90, from_y: 60, to_x: 10, to_y: 60 } }],
]) test(`rotation before a batch ${name} step refreshes dimensions`, { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const ax = (width, height) => ({ elements: [
    { role: 'Application', label: 'Fixture', frame: { x: 0, y: 0, width, height } },
    { role: 'Button', label: 'Go', frame: { x: 10, y: 10, width: 40, height: 20 } },
  ] });
  await f.set(ax(100, 200));
  assert.ok(!(await f.call('tap', { x: 80, y: 170, return_observation: true })).isError);
  await sharp({ create: { width: 200, height: 100, channels: 3, background: 'white' } }).png().toFile(f.image);
  await f.set(ax(200, 100));
  const before = (await f.events()).length;
  assert.ok(!(await f.call('batch_commands', { commands: [command] })).isError);
  const drags = (await f.events()).slice(before).filter(e => e.op === 'drag');
  assert.equal(drags.length, 1);
  assert.deepEqual([drags[0].request.x1, drags[0].request.y1],
    [Math.round(90 / 199 * 65535), Math.round(60 / 99 * 65535)],
    'The first batch step must use the landscape 200×100 viewport');
});

// Regression for the upstream unchanged-screen confirmation: a delayed AX
// read can be a different object with the same structure. It should not
// disable the opt-in receipt even if screen_stable reporting stays conservative.
test('unchanged screen after delayed confirmation still has a reusable AX receipt', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  await f.set({ label: 'Unchanged', afterInput: null });
  const response = await f.call('press_key', { key: 'return', return_observation: true });
  assert.ok(!response.isError, 'The input was delivered');
  const result = value(response);
  assert.equal(result.screen_change, 'unchanged');
  assert.equal(result.post_action_observation?.version, 1,
    'A matching confirmation read must not drop the structured observation');
  assert.ok(result.post_action_observation?.elements.length);
  assert.ok(result.post_action_observation?.observation.structure_started_at >= result.input_completed_at);
});

test('changed delayed confirmation rejects post-action AX reuse', { timeout: 5000 }, async () => {
  // The first two reads settle on the old screen; the extra read used to
  // confirm an unchanged result sees a genuinely different screen.
  // Dropping the signature comparison in reuseStable must fail this test.
  const before = 'before-confirmation', after = 'after-confirmation';
  let reads = 0, observationCalls = 0;
  const ctx = {
    lastInputAt: -Infinity,
    lastInputCompletedAt: new Date(Date.now() - 1000).toISOString(),
    size: { device: 'fixture-phone', width: 100, height: 200 },
    coordinator: { revision: () => 1 },
    settle: async () => {},
    readCost: () => 0,
    structure: async () => {
      const changed = ++reads >= 3;
      const stamp = new Date().toISOString();
      return {
        device: 'fixture-phone', revision: 1,
        signature: changed ? after : before,
        foreground: { bundle_id: 'local.fixture' },
        elements: [{ role: 'Button', label: changed ? 'After' : 'Before',
          visible: true, frame: { x: 10, y: 10, width: 40, height: 20 } }],
        startedAt: performance.now(),
        structure_started_at: stamp, structure_completed_at: stamp,
      };
    },
    observationFromStructure: () => {
      observationCalls++;
      return { id: 'should-not-be-created', device: 'fixture-phone', revision: 1, width: 100, height: 200 };
    },
    nextRef: 0,
  };
  const result = await readScreen(ctx, {
    structured: true, before,
    confirmation: { intervalMs: 1, withinMs: 30 },
  });
  assert.equal(reads, 3, 'The changed screen must appear on the delayed confirmation read');
  assert.equal(result.signature, after);
  assert.equal(result.structuredObservation, undefined,
    'A changed confirmation must not become a reusable action receipt');
  assert.equal(observationCalls, 0, 'The changed tree must not be bound to fresh element refs');
  assert.ok(result.screen.text.some(line => line.includes('After')));
});
