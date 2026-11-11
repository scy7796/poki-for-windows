import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

test('A batch with no device and two phones reports the device choice instead of crashing in the read-back', async t => {
  const f = await fixture(t);
  await f.set({ twoPhones: true, label: 'Ready' });
  const result = await f.call('batch_commands', { commands: [{ tool: 'launch_app', arguments: { bundle_id: 'local.fixture' } }] });
  assert.equal(result.isError, true);
  const text = result.content.map(block => block.text ?? '').join('\n');
  assert.doesNotMatch(text, /Cannot read properties of undefined/);
  assert.match(text, /Multiple devices match/);
  assert.equal((await f.events()).filter(event => event.op === 'launch_app').length, 0, 'Nothing may launch while the device is ambiguous');
});
