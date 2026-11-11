import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { root } from '../src/config.mjs';

const exec = promisify(execFile);
const cli = join(root, 'bin/install-iphone.mjs');
const UDID = '00008140-000000000000001E';
const BUNDLE = 'nz.zheha.poki.TEAM000001';
// Swift's JSONEncoder (.deferredToDate) writes seconds since 2001-01-01.
const swiftDate = iso => (Date.parse(iso) - Date.UTC(2001, 0, 1)) / 1000;
const entry = (kind, at) => ({ id: crypto.randomUUID(), kind, at: swiftDate(at) });

// An xcrun whose devicectl answers from a folder laid out like Poki's app container, the way
// devicectl does: JSON in --json-output, a file or a folder's contents copied to --destination.
const fakeXcrun = `#!/usr/bin/env node
const { cpSync, writeFileSync, appendFileSync, existsSync, statSync } = require('node:fs');
const { join } = require('node:path');
const a = process.argv.slice(2);
appendFileSync(process.env.FAKE_CALLS, a.join(' ') + '\\n');
const get = name => a[a.indexOf(name) + 1];
const out = result => writeFileSync(get('--json-output'), JSON.stringify({ info: { outcome: 'success' }, result }));
const cmd = a.slice(1, 4).join(' ');
if (cmd.startsWith('list devices')) out({ devices: [{ hardwareProperties: { udid: '${UDID}', platform: 'iOS' }, connectionProperties: { transportType: 'wired' } }] });
else if (cmd === 'device info apps') out({ apps: [
  { bundleIdentifier: '${BUNDLE}', name: 'Poki', version: '0.2.8', bundleVersion: '501' },
  { bundleIdentifier: '${BUNDLE}.PokiWidgets', name: 'PokiWidgets', version: '0.2.8', bundleVersion: '501' },
] });
else if (cmd === 'device copy from') {
  const source = join(process.env.FAKE_CONTAINER, get('--source'));
  if (!existsSync(source)) { console.error('ERROR: Failed to retrieve the file node for ' + get('--source') + ' (com.apple.dt.CoreDeviceError error 7000 (0x1B58))'); process.exit(1); }
  cpSync(source, get('--destination'), { recursive: true });
  out({});
} else { console.error('unexpected: ' + a.join(' ')); process.exit(1); }
`;

async function fakePhone(t) {
  const dir = await mkdtemp(join(tmpdir(), 'poki-records-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  const container = join(dir, 'container');
  const sessions = join(container, 'Library/Application Support/Poki/Sessions');
  await mkdir(bin, { recursive: true });
  await mkdir(sessions, { recursive: true });
  await mkdir(join(container, 'Library/Caches'), { recursive: true });
  await writeFile(join(bin, 'xcrun'), fakeXcrun);
  await chmod(join(bin, 'xcrun'), 0o755);
  const later = {
    id: 'b-chat', kind: 'poki', title: 'Check the weather', started: swiftDate('2026-11-09T03:10:00Z'), updated: swiftDate('2026-11-09T03:11:00Z'),
    live: false, outcome: 'done', calls: [{ name: 'do', arguments: '{"actions":[{"launch":"com.apple.weather"}]}', answer: 'app: Weather', ms: 900, ok: true }],
    connector: 'f'.repeat(64),
    entries: [
      entry({ time: { _0: swiftDate('2026-11-09T03:10:00Z') } }, '2026-11-09T03:10:00Z'),
      entry({ you: { _0: 'What is the weather?', delivered: true } }, '2026-11-09T03:10:01Z'),
      entry({ poki: { _0: 'Sunny, 21°.' } }, '2026-11-09T03:10:30Z'),
    ],
  };
  const earlier = {
    id: 'a-voice', kind: 'poki', title: 'New conversation', started: swiftDate('2026-11-09T02:00:00Z'), updated: swiftDate('2026-11-09T02:05:00Z'),
    live: false, calls: [],
    entries: [
      entry({ time: { _0: swiftDate('2026-11-09T02:00:00Z') } }, '2026-11-09T02:00:00Z'),
      entry({ you: { _0: '用微信给小明发消息', delivered: true } }, '2026-11-09T02:00:05Z'),
      entry({ step: { _0: 'Using the phone', ok: true } }, '2026-11-09T02:00:06Z'),
      entry({ poki: { _0: '微信还在打开中。' } }, '2026-11-09T02:00:09Z'),
      entry({ note: { _0: { problem: { _0: 'The relay https://poki-relay.someone.workers.dev/r/abc did not answer' } } } }, '2026-11-09T02:00:10Z'),
    ],
  };
  await writeFile(join(sessions, 'b-chat.json'), JSON.stringify(later));
  await writeFile(join(sessions, 'a-voice.json'), JSON.stringify(earlier));
  await writeFile(join(container, 'Library/Caches/poki-log.txt'), [
    '10:00:01.000 [app] Poki started (0.2.8 build 501)',
    '10:00:06.120 [voice] tool do {"actions":[{"launch":"com.tencent.xin"}]}',
    `10:00:06.200 [background] iOS would not register ${BUNDLE}.run.*`,
    '10:00:07.300 [model] OpenAI key sk-proj-abcdefghijklmnopqrstuvwxyz0123456789 rejected',
  ].join('\n'));
  const calls = join(dir, 'calls.txt');
  await writeFile(calls, '');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_CONTAINER: container, FAKE_CALLS: calls, TZ: 'Asia/Shanghai' };
  return { dir, env, calls, container };
}

test('records copies the chats, voice turns and log off the phone into one readable file in time order, without keys or relay addresses', async t => {
  const phone = await fakePhone(t);
  const state = join(phone.dir, 'state');
  const { stdout } = await exec(process.execPath, [cli, 'records', '--state', state], { env: phone.env });
  const file = stdout.match(/ to (\/.+\.txt)$/m)?.[1];
  assert.ok(file?.startsWith(join(state, 'records')), `prints where the file went: ${stdout}`);
  assert.match(stdout, /^Wrote 2 conversations and 4 log lines from Poki 0\.2\.8 \(501\)/);
  assert.doesNotMatch(stdout, /小明|weather/i, 'the conversation itself is in the file, not on the terminal');
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  const text = await readFile(file, 'utf8');
  const order = ['10:00:05  You: 用微信给小明发消息', '10:00:06    · Using the phone', '10:00:09  Poki: 微信还在打开中。', '11:10:01  You: What is the weather?', '11:10:30  Poki: Sunny, 21°.', '== Poki log', '10:00:06.120 [voice] tool do'];
  let at = -1;
  for (const line of order) {
    const next = text.indexOf(line);
    assert.ok(next > at, `"${line}" comes after the line before it in:\n${text}`);
    at = next;
  }
  assert.match(text, /== 2026-11-09 11:10:00 {2}Chat with Poki: Check the weather {2}\[done\]/);
  assert.match(text, /- do \{"actions":\[\{"launch":"com\.apple\.weather"\}\]\} → ok in 900 ms/);
  assert.doesNotMatch(text, /sk-proj-|workers\.dev|f{64}/, 'no key, relay address or connector hash');
  assert.ok(![UDID, BUNDLE].some(id => text.includes(id) || stdout.includes(id)), 'no UDID or team bundle id');

  const devicectl = (await readFile(phone.calls, 'utf8')).trim().split('\n');
  assert.ok(devicectl.every(line => /^devicectl (list devices|device info apps|device copy from) /.test(line)), `only reads the phone:\n${devicectl.join('\n')}`);
  assert.ok(devicectl.filter(l => l.includes('copy from')).every(l => l.includes(`--domain-identifier ${BUNDLE} `)), 'copies from Poki itself, not its widget extension');
});

test('records on a phone where Poki never saved anything says so instead of failing', async t => {
  const phone = await fakePhone(t);
  await rm(join(phone.container, 'Library'), { recursive: true, force: true });
  const out = join(phone.dir, 'empty.txt');
  const { stdout } = await exec(process.execPath, [cli, 'records', '--out', out, '--state', join(phone.dir, 'state')], { env: phone.env });
  assert.match(stdout, /^Wrote 0 conversations and 0 log lines/);
  assert.match(await readFile(out, 'utf8'), /\(no log on the phone\)/);
});
