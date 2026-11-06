import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fixture } from './fixture.mjs';

// The recognizer is one resident child shared by every session. These four cases are the
// ones that were missing while the child was started per call and its replies were matched
// by position: a leak, a stray line handed to the next caller, a request that never came
// back wedging the queue, and one session's close killing the engine for the others.
const value = result => JSON.parse(result.content.find(block => block.type === 'text').text);
const listing = (f, client = f.a) => client.callTool({ name: 'list_elements', arguments: { source: 'ocr' } }).then(value);
const starts = async f => (await f.events()).filter(event => event.op === 'ocr_start');

test('five recognitions start one child', async t => {
  const f = await fixture(t);
  for (let round = 0; round < 5; round++) await listing(f);
  assert.equal((await starts(f)).length, 1, 'the helper must stay resident across frames');
});

test('a line that is not a reply is skipped, and the next frame gets its own answer', async t => {
  const f = await fixture(t, { beforeStart: dir => writeFile(join(dir, 'fixture.json'), JSON.stringify({ ocrJunkOnce: true, ocrXs: [10, 70] })) });
  const first = await listing(f);
  assert.equal(first.elements[0].frame.x, 10, 'the first frame keeps its own coordinates');
  const second = await listing(f);
  assert.equal(second.elements[0].frame.x, 70, 'the second frame must not receive the first frame answer');
});

test('an unanswered request ends its child, and the next request starts a new one', async t => {
  const f = await fixture(t, { env: { POKI_OCR_TIMEOUT_MS: '1500' }, beforeStart: dir => writeFile(join(dir, 'fixture.json'), JSON.stringify({ ocrHangOnce: true })) });
  const started = Date.now();
  const hung = await listing(f);
  assert.ok(Date.now() - started < 15000, 'the wait must end at the timeout');
  assert.ok(Array.isArray(hung.elements), 'the answer after a hang is still a listing');
  const after = await listing(f);
  assert.ok(Array.isArray(after.elements), 'the next request is answered normally');
  assert.ok((await starts(f)).length >= 2, 'the killed child is replaced');
});

test('closing one session leaves another session recognition alone', async t => {
  const f = await fixture(t);
  const b = await f.connect();
  await listing(f, b);
  await f.a.close();
  const still = await listing(f, b);
  assert.ok(Array.isArray(still.elements), 'the second session keeps recognizing');
  assert.equal((await starts(f)).length, 1, 'the engine was not restarted when the other session closed');
});
