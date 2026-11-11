import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, value } from './fixture.mjs';

test('observe_device omits PNG only when requested', async t => {
  const f = await fixture(t);
  const defaultResult = await f.call('observe_device', { source: 'ocr' });
  const compactResult = await f.call('observe_device', { source: 'ocr', include_image: false });
  assert.ok(!defaultResult.isError);
  assert.ok(!compactResult.isError);
  assert.ok(defaultResult.content.some(item => item.type === 'image'));
  assert.ok(!compactResult.content.some(item => item.type === 'image'));
  const first = value(defaultResult), second = value(compactResult);
  assert.notEqual(first.observation.id, second.observation.id);
  assert.equal(second.observation.atomic, false);
  assert.equal(second.source, 'ocr');
  assert.equal(second.prompt.status, 'checked');
  assert.ok(second.elements.length > 0);
  assert.ok(second.elements.every(element => /^e\d+$/.test(element.ref)));
  const screenshots = (await f.events()).filter(event => event.args?.includes('screenshot'));
  assert.equal(screenshots.length, 2, 'Internal capture still occurs for structured-only responses');
});
test('missing prompt OCR remains explicit without an image attachment', async t => {
  const f = await fixture(t);
  await f.set({ ocrUnavailable: true });
  const result = await f.call('observe_device', { include_image: false });
  assert.ok(!result.isError);
  const data = value(result);
  assert.equal(data.prompt.status, 'unavailable');
  assert.match(data.prompt.instruction, /Take a screenshot/);
  assert.ok(!result.content.some(item => item.type === 'image'));
});
test('observe_device rejects non-boolean include_image', async t => {
  const f = await fixture(t);
  const result = await f.call('observe_device', { include_image: 'false' });
  assert.equal(result.isError, true);
});

// Issue #60: JD's results page names its search box and four tabs; the products under them are drawn
// without accessibility elements and are only in the screenshot.
test('a tree that names only the top of the screen gets the screenshot text it left out', { timeout: 30000 }, async t => {
  const named = (role, label, x, y, width, height) => ({ role, label, frame: { x, y, width, height } });
  const seen = (text, x, y, width, height) => ({ text, x, y, width, height });
  const header = [['StaticText', '力矩扳手', 10, 4, 80, 16], ['Button', '综合', 0, 24, 25, 16], ['Button', '视频', 25, 24, 25, 16], ['Button', '直播', 50, 24, 25, 16], ['Button', '用户', 75, 24, 25, 16]];
  const products = [['2-20Nm 预置扭力扳手', 5, 60, 90, 14], ['¥89', 5, 78, 30, 14], ['加入购物车', 50, 96, 45, 16]];
  const state = { elements: header.map(e => named(...e)), ocrElements: [...header.map(([, ...e]) => seen(...e)), ...products.map(e => seen(...e))] };
  const f = await fixture(t);
  await f.set(state);
  const listed = value(await f.call('list_elements'));
  assert.deepEqual(listed.elements.map(e => [e.label, e.source]), [...header.map(e => [e[1], undefined]), ...products.map(e => [e[0], 'ocr'])]);
  assert.equal(value(await f.call('list_elements', { source: 'accessibility' })).elements.length, 5);
  const cua = await fixture(t, { toolsProfile: 'cua' });
  await cua.set(state);
  const looked = (await cua.call('look')).content[0].text;
  assert.match(looked, /, accessibility \+ ocr\)/);
  assert.deepEqual(looked.split('\n').filter(line => /^[ +]\d+ /.test(line)).map(line => line.match(/"(.*)"/)[1]), [...header.map(e => e[1]), ...products.map(e => e[0])]);
});
