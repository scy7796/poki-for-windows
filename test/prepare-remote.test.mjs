import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from '../src/config.mjs';

test('remote setup persists a Bonjour host for future resolution and preserves IP setups', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'poki-remote-setup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'bin'));
  await mkdir(join(dir, 'src'));
  await cp(join(root, 'bin/prepare-remote.mjs'), join(dir, 'bin/prepare-remote.mjs'));
  await cp(join(root, 'src/config.mjs'), join(dir, 'src/config.mjs'));
  const log = join(dir, 'calls');
  const fake = `#!${process.execPath}
import { appendFileSync, writeFileSync } from 'node:fs';
appendFileSync(process.env.SETUP_CALLS, 'call\\n');
const a=process.argv.slice(2);
if(a.includes('pair'))writeFileSync(a.at(-1),'synthetic pairing record');
else if(a.includes('verify'))console.log('the device recognizes this pairing record');
else if(a.includes('DeviceName'))console.log(JSON.stringify('Synthetic phone'));
else console.log(JSON.stringify([{id:'synthetic-phone',connection:'USB'}]));
`;
  for (const name of ['python3', 'idevice']) await writeFile(join(dir, 'bin', name), fake, { mode: 0o755 });
  const run = (host, state) => spawnSync(process.execPath, [join(dir, 'bin/prepare-remote.mjs'), 'synthetic-phone', host], {
    encoding: 'utf8', env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH,
      POKI_MCP_STATE_DIR: state, IDEVICE_TOOLS: join(dir, 'bin/idevice'), SETUP_CALLS: log },
  });
  for (const [index, host] of ['phone.local', 'Phone-2.local.', '192.0.2.1', 'fd00::1', 'fe80::1%en0', 'fe80::1%4'].entries()) {
    const state = join(dir, 'state-' + index);
    const result = run(host, state);
    assert.equal(result.status, 0, `${host}: ${result.stderr}`);
    const config = JSON.parse(await readFile(join(state, 'remote/synthetic-phone/config.json'), 'utf8'));
    assert.equal(config.host, host, 'persist the name rather than a one-time IP resolution');
    assert.equal(config.port, 49152);
    const next = JSON.parse(result.stdout).next;
    if (/\.local\.?$/i.test(host)) {
      assert.match(next, /same LAN/);
      assert.doesNotMatch(next, /cellular/);
    } else assert.match(next, /Tailscale/);
  }
  const before = await readFile(log, 'utf8');
  for (const host of ['example.com', 'phone', '-phone.local', 'phone..local', 'phone.local:1234', 'phone.local/path', 'phone.local\n']) {
    const result = run(host, join(dir, 'invalid'));
    assert.equal(result.status, 1, host);
    assert.match(result.stderr, /Usage:/);
  }
  assert.equal(await readFile(log, 'utf8'), before, 'invalid hosts must not access devices');
});
