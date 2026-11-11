import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ensureSetupApp } from '../src/install/setup-app.mjs';
import { run } from '../src/install/run.mjs';

const asset = name => ({ name, browser_download_url: `https://github.com/assets/${name}`, url: `https://api.github.com/assets/${name}` });
const hash = text => createHash('sha256').update(text).digest('hex');
async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'poki-download-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('DMG 504 falls back to the asset API but still rejects a checksum mismatch', async t => {
  const dir = await scratch(t);
  const name = 'PokiSetup-0.2.1-999999-macos.dmg';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/releases?')) return Response.json([{ tag_name: 'ios-alpha-latest', assets: [asset(name), asset('SHA256SUMS-desktop.txt')] }]);
    if (url.startsWith('https://github.com/')) return new Response('', { status: 504 });
    assert.equal(options.headers.Accept, 'application/octet-stream');
    return new Response(url.endsWith('.dmg') ? 'corrupt' : `${hash('expected')}  ${name}\n`);
  });
  await assert.rejects(ensureSetupApp({ channel: 'alpha', into: dir, downloads: join(dir, 'downloads') }), { code: 'setup_checksum_mismatch' });
});

test('a bridge download failure installs a verified local IPA with its matching signing zip', async t => {
  const dir = await scratch(t);
  const bridge = join(dir, 'bridge.mjs');
  const fake = new URL('../src/install/fake-bridge.mjs', import.meta.url).pathname;
  await writeFile(bridge, `
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
const child = spawn(process.execPath, [${JSON.stringify(decodeURIComponent(fake))}], { stdio: ['pipe', 'pipe', 'inherit'] });
child.stdout.pipe(process.stdout);
createInterface({ input: process.stdin }).on('line', line => {
 const r = JSON.parse(line);
 if (r.cmd === 'install') {
  if (!r.args.ipa) { console.log(JSON.stringify({id:r.id,err:{kind:'http',message:'GitHub 504'}})); return; }
  if (readFileSync(r.args.ipa, 'utf8') !== 'IPA' || readFileSync(join(dirname(r.args.ipa), 'Poki-signing.zip'), 'utf8') !== 'SIGNING') throw Error('wrong local release');
 }
 child.stdin.write(line + '\\n');
}).on('close', () => child.stdin.end());
`);
  const name = 'Poki-external-0.2.8-501.ipa';
  const bodies = { [name]: 'IPA', 'Poki-signing.zip': 'SIGNING', SHA256SUMS: `${hash('IPA')}  ${name}\n` };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/releases/tags/')) return Response.json({ assets: Object.keys(bodies).map(asset) });
    if (url.startsWith('https://github.com/')) return new Response('', { status: 504 });
    assert.equal(options.headers.Accept, 'application/octet-stream');
    return new Response(bodies[url.split('/').at(-1)]);
  });
  for (const [key, value] of Object.entries({ POKI_FAKE_DELAY_MS: '5', POKI_INSTALL_POLL_MS: '5', POKI_INSTALL_RETRY_MS: '1', POKI_INSTALL_WAIT_MS: '2000' })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
  const events = [];
  t.mock.method(process.stdout, 'write', line => { events.push(JSON.parse(line)); return true; });
  const code = await run({ state: dir, bridge, channel: 'alpha', dryRun: true, json: true });
  assert.equal(code, 0, JSON.stringify(events));
  assert.equal(events.at(-1).ok, true);
  assert.equal((JSON.parse(await readFile(join(dir, 'run.json'), 'utf8'))).steps.install.status, 'ok');
});
