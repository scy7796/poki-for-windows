import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.mjs';
import { root } from '../src/config.mjs';

// The voice bridge in front of a fixture daemon and phone, as the Poki app reaches it.
async function bridge(t, f) {
  await copyFile(join(root, 'bin/voice-bridge.mjs'), join(f.dir, 'bin/voice-bridge.mjs'));
  const child = spawn(process.execPath, [join(f.dir, 'bin/voice-bridge.mjs'), '--port', '0', '--host', '127.0.0.1', '--mac-tools'], { env: { ...f.env, OPENAI_API_KEY: 'unused' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  t.after(async () => { child.kill(); await exited; });
  const lines = createInterface({ input: child.stdout });
  const [line] = await once(lines, 'line');
  const { port } = JSON.parse(line);
  const { secret } = JSON.parse(await readFile(join(f.env.POKI_MCP_STATE_DIR, 'voice-bridge.json'), 'utf8'));
  return body => fetch(`http://127.0.0.1:${port}/voice/${secret}/tool`, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
}

test('a voice tap_text the phone has not checked taps nothing; once checked it taps once', async t => {
  const f = await fixture(t);
  await f.set({ label: 'Send' });
  const tool = await bridge(t, f);
  const taps = async () => (await f.events()).filter(e => e.op === 'tap').length;

  // "tap Send", as the model asks for it: the bridge says what it would tap and where, and taps nothing.
  const check = await tool({ call_id: 'c1', name: 'tap_text', arguments: { text: 'Send' } });
  assert.equal(await taps(), 0, JSON.stringify(check));
  assert.equal(check.state, 'check', JSON.stringify(check));
  assert.equal(check.target.text, 'Send');

  // The phone cleared it (its rules, or the owner's OK): the same call taps that element once.
  const done = await tool({ call_id: 'c1', name: 'tap_text', arguments: { text: 'Send' }, checked: { app: check.app.bundle_id, text: check.target.text } });
  assert.equal(done.state, 'done', JSON.stringify(done));
  assert.equal(await taps(), 1);
});

test('a voice tap_text with Poki in front taps nothing, checked or not', async t => {
  const f = await fixture(t);
  await f.set({ label: 'Allow', bundleId: 'nz.zheha.poki', appName: 'Poki' });
  const tool = await bridge(t, f);
  const taps = async () => (await f.events()).filter(e => e.op === 'tap').length;

  // The approval card is in Poki: "tap Allow" is refused before the phone is asked.
  const check = await tool({ call_id: 'c1', name: 'tap_text', arguments: { text: 'Allow' } });
  assert.equal(check.state, 'failed', JSON.stringify(check));
  assert.match(check.output, /only the phone's owner/);

  // A call that says Poki was checked is refused too.
  const done = await tool({ call_id: 'c2', name: 'tap_text', arguments: { text: 'Allow' }, checked: { app: 'nz.zheha.poki', text: 'Allow' } });
  assert.equal(done.state, 'failed', JSON.stringify(done));
  assert.equal(await taps(), 0);
});

test('a voice tap_text on an element known only by its identifier shows the phone that name', async t => {
  const f = await fixture(t);
  await f.set({ elements: [{ role: 'Button', identifier: 'Send', frame: { x: 10, y: 10, width: 40, height: 20 } }] });
  const tool = await bridge(t, f);

  // The phone checks what it is told the element says: the identifier the tap matches, not nothing.
  const check = await tool({ call_id: 'c1', name: 'tap_text', arguments: { text: 'Send' } });
  assert.equal(check.state, 'check', JSON.stringify(check));
  assert.match(check.target.says, /\bSend\b/);
  assert.equal((await f.events()).filter(e => e.op === 'tap').length, 0);
});
