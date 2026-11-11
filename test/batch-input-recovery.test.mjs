import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, value } from './fixture.mjs';
const input = () => ({ phone: { keyboard: true, rows: [{ id: 'o2', placeholder: '地址和搜索栏', value: '', up: 70, down: 130, editing: true }] }, label: 'Ready' });
const summary = result => JSON.parse(result.content.at(-1).text);

test('Launch and fill use the current localized input; a wrong label returns an executable recovery without typing', async t => {
  const f = await fixture(t);
  await f.set(input());
  const commands = [{ tool: 'launch_app', arguments: { bundle_id: 'local.fixture' } }, { tool: 'fill', arguments: { text: 'esp32', submit: true } }];
  const direct = await f.call('batch_commands', { commands });
  assert.ok(!direct.isError, JSON.stringify(direct));
  assert.ok(direct.content.some(block => /"text_verified"\s*:\s*true/.test(block.text ?? '')));
  assert.equal((await f.events()).filter(event => event.request?.op === 'type_text').length, 1);
  await f.set(input());
  const failed = await f.call('batch_commands', { commands: [commands[0], { ...commands[1], arguments: { ...commands[1].arguments, field: 'Address and search bar' } }] });
  assert.equal(failed.isError, true);
  assert.equal((await f.events()).filter(event => event.request?.op === 'type_text').length, 1, 'A mismatched explicit label must not type into another field');
  const recovery = summary(failed);
  assert.deepEqual(recovery.next_commands, [{ tool: 'fill', arguments: { text: 'esp32', submit: true, field: '地址和搜索栏' } }]);
  assert.match(recovery.next, /current.*field|visible.*field/i);
  const retried = await f.call('batch_commands', { commands: recovery.next_commands });
  assert.ok(!retried.isError, JSON.stringify(retried));
  assert.equal(value(await f.call('list_elements')).elements.find(e => e.object_id === 'o2').value, 'esp32');
});

test('Ordinary app name launch recovers a cold directory disconnect, uses the warm directory, and reports persistent failures without launching', async t => {
  const f = await fixture(t);
  await f.set({ ...input(), appDirectoryFailures: 1 });
  const commands = [{ tool: 'launch_app', arguments: { name: 'Fixture' } }, { tool: 'fill', arguments: { text: 'sample', submit: true } }];
  const recovered = await f.call('batch_commands', { commands });
  assert.ok(!recovered.isError, JSON.stringify(recovered));
  assert.equal((await f.events()).filter(event => event.op === 'launch_app').length, 1, 'Only the read-only directory lookup may retry');
  assert.equal(value(await f.call('list_elements')).elements.find(e => e.object_id === 'o2').value, 'sample');
  await f.set({ ...input(), twoPhones: true, appDirectoryFailures: 3 });
  const warm = await f.call('launch_app', { device: 'fixture-phone', name: 'Fixture' });
  assert.ok(!warm.isError, JSON.stringify(warm));
  const launches = (await f.events()).filter(event => event.op === 'launch_app').length;
  const failed = await f.call('launch_app', { device: 'fixture-phone-2', name: 'Fixture' });
  assert.equal(failed.isError, true);
  assert.equal(value(failed).outcome, 'not_sent');
  assert.match(value(failed).instruction, /No app was launched/);
  assert.equal((await f.events()).filter(event => event.op === 'launch_app').length, launches);
  const direct = await f.call('launch_app', { device: 'fixture-phone-2', bundle_id: 'local.fixture' });
  assert.ok(!direct.isError, JSON.stringify(direct));
  assert.equal(value(direct).bundle_id, 'local.fixture');
});

test('Input on a phone without displayservice reports nothing sent and names the preparation command', async t => {
  const f = await fixture(t);
  // The native helper's reply when the phone offers no display service; remote.rs a_service_refused_on_a_live_tunnel_keeps_that_tunnel proves it.
  await f.set({ inputReply: { isError: true, outcome: 'not_sent', stop_reason: 'error', sent: false, screen_change_verified: false, reason: 'display_service_missing', error: 'Cannot establish input media session: no display service: ServiceNotFound', instruction: 'Nothing reached the iPhone. Keep it connected and unlocked, then retry.' } });
  const failed = await f.call('press_key', { key: 'return' });
  assert.equal(failed.isError, true);
  const result = value(failed);
  assert.equal(result.outcome, 'not_sent');
  assert.match(result.instruction, /node bin\/prepare-device\.mjs fixture-phone/);
});

test('Input refused while the microphone or camera is in use reports nothing sent and says what to end', async t => {
  const f = await fixture(t);
  // The native helper's reply for that refusal; remote.rs an_input_refused_while_the_microphone_is_in_use_says_so proves it.
  await f.set({ inputReply: { isError: true, outcome: 'not_sent', stop_reason: 'error', sent: false, screen_change_verified: false, reason: 'media_in_use', error: "Cannot establish input media session: the iPhone's microphone or camera is in use", instruction: 'Nothing reached the iPhone. Keep it connected and unlocked, then retry.' } });
  const failed = await f.call('press_key', { key: 'return' });
  assert.equal(failed.isError, true);
  const result = value(failed);
  assert.equal(result.outcome, 'not_sent');
  assert.match(result.instruction, /microphone or camera/);
  assert.doesNotMatch(result.instruction, /unlocked/);
});
