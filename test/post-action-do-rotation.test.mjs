import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixture, value } from './fixture.mjs';


test('rotation before a do coordinate tap refreshes dimensions', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const ax = (width, height, label = 'Go') => [
    { role: 'Application', label: 'Fixture', frame: { x: 0, y: 0, width, height } },
    { role: 'Button', label, frame: { x: 10, y: 10, width: 40, height: 20 } },
  ];
  // First tap changes the screen, so no delayed unchanged-screen confirmation.
  await f.set({ elements: ax(100, 200), afterInput: { elements: ax(100, 200, 'Done') } });
  const first = await f.call('tap', { x: 80, y: 170, return_observation: true });
  assert.ok(!first.isError);
  assert.ok(value(first).post_action_observation, 'AX-only binding created');
  await sharp({ create: { width: 200, height: 100, channels: 3, background: 'white' } })
    .png().toFile(f.image);
  await f.set({ elements: ax(200, 100, 'Done'), afterInput: null });
  const before = (await f.events()).length;
  const r = await f.call('do', { actions: [{ tap: [90, 60] }] });
  const taps = (await f.events()).slice(before).filter(e => e.op === 'tap');
  assert.equal(taps.length, 1, JSON.stringify(r.content));
  assert.deepEqual([taps[0].request.x, taps[0].request.y],
    [Math.round(90 / 199 * 65535), Math.round(60 / 99 * 65535)],
    'do must convert against the rotated 200×100 screen');
});
