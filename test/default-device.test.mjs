import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, value } from './fixture.mjs';

test('POKI_MCP_DEVICE picks the device when several match, and an explicit device still wins', async t => {
  const f = await fixture(t, { extraEnv: () => ({ POKI_MCP_DEVICE: 'fixture-phone-2' }) });
  await f.set({ twoPhones: true, label: 'Ready' });
  const launched = await f.call('launch_app', { bundle_id: 'local.fixture' });
  assert.ok(!launched.isError, JSON.stringify(launched));
  assert.equal(value(await f.call('poki_mcp_status')).selected, 'fixture-phone-2');
  const explicit = await f.call('select_device', { device: 'fixture-phone' });
  assert.equal(value(explicit).selected, 'fixture-phone');
  assert.equal(value(await f.call('poki_mcp_status')).selected, 'fixture-phone', 'select_device must override the default');
});

test('Without POKI_MCP_DEVICE two matching devices still ask for a choice', async t => {
  const f = await fixture(t);
  await f.set({ twoPhones: true, label: 'Ready' });
  const result = await f.call('launch_app', { bundle_id: 'local.fixture' });
  assert.equal(result.isError, true);
  assert.match(result.content.map(block => block.text ?? '').join('\n'), /Multiple devices match/);
});
