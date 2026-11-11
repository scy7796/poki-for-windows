import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, value } from './fixture.mjs';

const path = (...points) => points.map(([x, y, time_ms]) => ({ x, y, time_ms }));
const messageOf = result => result.content.find(c => c.type === 'text').text;

test('touch_path and draw_strokes reach the phone as timed HID strokes and invalid paths send nothing', async t => {
  const f = await fixture(t);
  const drawn = async () => (await f.events()).filter(e => e.op === 'draw_strokes').map(e => e.request.strokes);

  const circle = await f.call('touch_path', { points: path([0, 0, 0], [49.5, 99.5, 40], [99, 199, 80]) });
  assert.ok(!circle.isError, messageOf(circle));
  assert.equal(value(circle).sent, true);
  assert.deepEqual(await drawn(), [[path([0, 0, 0], [32768, 32768, 40], [65535, 65535, 80])]]);

  const signature = await f.call('draw_strokes', { strokes: [
    { points: path([0, 0, 0], [99, 0, 30]) },
    { points: path([0, 199, 0], [49.5, 99.5, 20], [99, 199, 50]) },
  ] });
  assert.ok(!signature.isError, messageOf(signature));
  assert.equal(value(signature).sent, true);
  assert.deepEqual((await drawn())[1], [
    path([0, 0, 0], [65535, 0, 30]),
    path([0, 65535, 0], [32768, 32768, 20], [65535, 65535, 50]),
  ]);

  const line = n => Array.from({ length: n }, (_, i) => [10, 10, i]);
  for (const [tool, args, reason] of [
    ['touch_path', { points: path([10, 10, 5], [20, 20, 40]) }, /time_ms.*0/],
    ['touch_path', { points: path([10, 10, 0], [20, 20, 40], [30, 30, 40]) }, /increas/],
    ['touch_path', { points: path([10, 10, 0], [20, 20, 60001]) }, /60000/],
    ['touch_path', { points: path(...line(8193)) }, /8192 items/],
    ['touch_path', { points: path([10, 10, 0]) }, /2 items/],
    ['touch_path', { points: path([10, 10, 0], [100, 20, 40]) }, /inside the screen/],
    ['draw_strokes', { strokes: Array.from({ length: 13 }, () => ({ points: path([10, 10, 0], [20, 20, 10]) })) }, /12 items/],
    ['draw_strokes', { strokes: [{ points: path([10, 10, 0], [20, 20, 40000]) }, { points: path([10, 10, 0], [20, 20, 30000]) }] }, /60000/],
    ['draw_strokes', { strokes: [{ points: path([10, 10, 0], [20, 20, 40]) }, { points: path([10, 10, 0], [20, 20, 30], [30, 30, 20]) }] }, /increas/],
  ]) {
    const before = (await drawn()).length;
    const rejected = await f.call(tool, args);
    assert.equal(rejected.isError, true, `${tool} ${reason}`);
    assert.match(messageOf(rejected), reason);
    assert.equal((await drawn()).length, before, `${tool} ${reason} must not send input`);
  }
});

test('simulator strokes each touch down, follow their timing and lift in their own HID batch', async t => {
  const f = await fixture(t);
  await f.set({ simulatorOnly: true, simulatorBooted: true });
  const before = (await f.events()).length;
  const result = await f.call('draw_strokes', { strokes: [
    { points: path([10, 20, 0], [50, 100, 30], [90, 180, 70]) },
    { points: path([20, 20, 0], [20, 60, 50]) },
  ] });
  assert.ok(!result.isError, messageOf(result));
  assert.equal(value(result).sent, true);
  const batches = (await f.events()).slice(before)
    .filter(e => e.op === 'hid' && e.request.events.some(event => event.messageType === 'IndigoDigitizerEvent'))
    .map(e => {
      let clock = 0;
      return e.request.events.flatMap((event, index) => {
        if (index > 0) clock += event.delay_ms ?? 0;
        return event.messageType ? [[event.payload.eventType, event.payload.pointOne.x, event.payload.pointOne.y, clock]] : [];
      });
    });
  assert.deepEqual(batches, [
    [[0, 0.1, 0.1, 0], [1, 0.5, 0.5, 30], [1, 0.9, 0.9, 70], [2, 0.9, 0.9, 70]],
    [[0, 0.2, 0.1, 0], [1, 0.2, 0.3, 50], [2, 0.2, 0.3, 50]],
  ]);
});
