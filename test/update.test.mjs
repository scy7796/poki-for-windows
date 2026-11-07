import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, writeFile, symlink, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { root } from '../src/config.mjs';
import { fixture, value } from './fixture.mjs';

const exec = promisify(execFile);
const release = { tag_name: 'v0.2.0', body: 'Updates are now available. More details follow.', html_url: 'https://github.com/scy7796/poki-for-windows/releases/tag/v0.2.0', draft: false, prerelease: false };
async function cli(dir, args, env = {}) {
  try { return { code: 0, ...await exec(join(dir, 'bin/poki'), args, { cwd: dir, env: { ...process.env, POKI_MCP_STATE_DIR: join(dir, 'state'), ...env } }) }; }
  catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
}
async function copyCLI(dir) {
  await cp(join(root, 'bin'), join(dir, 'bin'), { recursive: true });
  await mkdir(join(dir, 'agent'), { recursive: true });
  for (const file of ['poki.mjs', 'poki-client.mjs', 'model-config.mjs']) await cp(join(root, 'agent', file), join(dir, 'agent', file));
  await symlink(join(root, 'agent/node_modules'), join(dir, 'agent/node_modules'), process.platform === 'win32' ? 'junction' : undefined);
}

test('MCP and CLI expose releases, honor opt-out and stay quiet offline', { skip: process.platform === 'win32' && 'the update flow installs with the macOS shell script; Windows runs bin/setup.ps1, which this fixture does not fake' }, async t => {
  for (const scenario of ['older', 'equal', 'newer', 'disabled', 'offline', 'cached', 'default']) await t.test(scenario, async t => {
    const f = await fixture(t, { beforeStart: async dir => {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      pkg.version = scenario === 'equal' ? '0.2.0' : scenario === 'newer' ? '0.3.0' : '0.1.0';
      await writeFile(join(dir, 'package.json'), JSON.stringify(pkg));
      await mkdir(join(dir, 'state'));
      if (scenario === 'cached') await writeFile(join(dir, 'state/update-check.json'), JSON.stringify({ checkedAt: Date.now(), release }));
      const daemon = join(dir, 'src/daemon.mjs');
      await writeFile(daemon, `${scenario === 'default' ? '' : `process.env.POKI_NO_UPDATE_CHECK = '${scenario === 'disabled' ? '1' : ''}';\n`}const originalFetch = globalThis.fetch;\nglobalThis.fetch = async (url, options) => {\n if (String(url) !== 'https://api.github.com/repos/scy7796/poki-for-windows/releases/latest') return originalFetch(url, options);\n await (await import('node:fs/promises')).appendFile(${JSON.stringify(join(dir, 'release-requests'))}, 'request\\n');\n if (options.headers.Authorization || options.headers.authorization) throw Error('Release request must be anonymous');\n ${['offline', 'cached', 'disabled'].includes(scenario) ? "throw Error('Synthetic offline network');" : `return new Response(JSON.stringify(${JSON.stringify(release)}), { status: 200 });`}\n};\n` + await readFile(daemon, 'utf8'));
      await copyCLI(dir);
    } });
    const result = value(await f.call('poki_mcp_status'));
    const visible = ['older', 'cached'].includes(scenario);
    if (visible) assert.deepEqual(result.update, { version: '0.2.0', summary: 'Updates are now available.', url: release.html_url, command: 'git pull --ff-only, then ./bin/setup.ps1' });
    else assert.equal(result.update, undefined);
    if (['cached', 'disabled', 'default'].includes(scenario)) await assert.rejects(readFile(join(f.dir, 'release-requests')), { code: 'ENOENT' });
    if (scenario === 'offline') assert.equal(JSON.parse(await readFile(join(f.dir, 'state/update-check.json'), 'utf8')).release, null);
    const status = await cli(f.dir, ['status'], { ...f.env, POKI_AGENT_AUTH: 'api-key', OPENAI_API_KEY: '', POKI_NO_UPDATE_CHECK: scenario === 'disabled' ? '1' : '' });
    assert.equal(status.code, 0, status.stderr);
    if (visible) assert.match(status.stdout, /Poki 0\.2\.0 available[\s\S]*Updates are now available\.[\s\S]*releases\/tag\/v0\.2\.0[\s\S]*bin\/setup\.ps1/);
    else assert.doesNotMatch(status.stdout, /available|setup\.ps1/);
    t.diagnostic(`$ node bin/call.mjs poki_mcp_status (${scenario}, synthetic release/device)\n${JSON.stringify(result)}\n$ poki status\n${status.stdout}`);
    if (scenario === 'older') {
      const disabled = await cli(f.dir, ['status'], { ...f.env, POKI_AGENT_AUTH: 'api-key', POKI_NO_UPDATE_CHECK: '1' });
      assert.doesNotMatch(disabled.stdout, /setup\.ps1/);
    }
  });
});

test('poki update fast-forwards a clean main checkout and preserves dirty or non-main checkouts', { skip: process.platform === 'win32' && 'the update flow installs with the macOS shell script; Windows runs bin/setup.ps1, which this fixture does not fake' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'poki-update-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const upstream = join(dir, 'upstream'), installed = join(dir, 'installed');
  await mkdir(upstream);
  await cp(join(root, 'src'), join(upstream, 'src'), { recursive: true });
  await cp(join(root, 'package.json'), join(upstream, 'package.json'));
  await copyCLI(upstream);
  await writeFile(join(upstream, '.gitignore'), 'node_modules\nagent/node_modules\nbuild/\n.env\n');
  await writeFile(join(upstream, 'bin/setup'), '#!/bin/sh\nset -eu\nmkdir -p build\nnode -p "JSON.parse(require(\'fs\').readFileSync(\'package.json\')).version" > build/version\n', { mode: 0o755 });
  const git = (cwd, ...args) => exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd });
  await git(upstream, 'init', '-b', 'main');
  await git(upstream, 'add', '.'); await git(upstream, 'commit', '-m', 'fixture baseline');
  await git(dir, 'clone', upstream, installed);
  await symlink(join(root, 'agent/node_modules'), join(installed, 'agent/node_modules'), process.platform === 'win32' ? 'junction' : undefined);
  await symlink(join(root, 'node_modules'), join(installed, 'node_modules'));
  const pkg = JSON.parse(await readFile(join(upstream, 'package.json'), 'utf8')); pkg.version = '0.2.0';
  await writeFile(join(upstream, 'package.json'), JSON.stringify(pkg));
  await git(upstream, 'commit', '-am', 'fixture release');
  const before = (await git(installed, 'rev-parse', 'HEAD')).stdout;
  await writeFile(join(installed, 'local-note'), 'keep this');
  const dirty = await cli(installed, ['update']);
  assert.notEqual(dirty.code, 0); assert.match(dirty.stderr, /local changes/i);
  assert.equal((await git(installed, 'rev-parse', 'HEAD')).stdout, before);
  assert.equal(await readFile(join(installed, 'local-note'), 'utf8'), 'keep this');
  await rm(join(installed, 'local-note'));
  const original = await readFile(join(installed, 'package.json'), 'utf8');
  await writeFile(join(installed, 'package.json'), original + '\n');
  const tracked = await cli(installed, ['update']);
  assert.notEqual(tracked.code, 0); assert.match(tracked.stderr, /local changes/i);
  assert.equal(await readFile(join(installed, 'package.json'), 'utf8'), original + '\n');
  await writeFile(join(installed, 'package.json'), original);
  await git(installed, 'switch', '-c', 'feature');
  const branch = await cli(installed, ['update']);
  assert.notEqual(branch.code, 0); assert.match(branch.stderr, /main/);
  await git(installed, 'switch', 'main');
  const updated = await cli(installed, ['update']);
  assert.equal(updated.code, 0, updated.stderr); assert.match(updated.stdout, /npm start/);
  assert.equal((await git(installed, 'rev-parse', 'HEAD')).stdout, (await git(upstream, 'rev-parse', 'HEAD')).stdout);
  assert.equal((await readFile(join(installed, 'build/version'), 'utf8')).trim(), '0.2.0');
  t.diagnostic(`Synthetic local release remote and setup script. Real Git update and CLI.\n$ poki update (dirty)\n${dirty.stderr}\n$ poki update (feature branch)\n${branch.stderr}\n$ poki update (clean main)\n${updated.stdout}`);
  await t.test('preserves ignored files when upstream starts tracking them', async () => {
    await writeFile(join(installed, '.env'), 'local fixture data\n');
    await writeFile(join(upstream, '.env'), 'upstream fixture data\n');
    await git(upstream, 'add', '-f', '.env');
    await git(upstream, 'commit', '-m', 'fixture tracked environment');
    const head = (await git(installed, 'rev-parse', 'HEAD')).stdout;
    assert.equal((await git(installed, 'status', '--porcelain', '--untracked-files=all')).stdout, '');
    await rm(join(installed, 'build/version'));
    const conflict = await cli(installed, ['update']);
    const contents = await readFile(join(installed, '.env'), 'utf8');
    t.diagnostic(`$ poki update (ignored .env collision)\n${conflict.stdout}${conflict.stderr}exit=${conflict.code}\n.env=${contents}`);
    assert.equal(contents, 'local fixture data\n');
    assert.notEqual(conflict.code, 0);
    assert.match(conflict.stderr, /\.env/);
    assert.equal((await git(installed, 'rev-parse', 'HEAD')).stdout, head);
    await assert.rejects(readFile(join(installed, 'build/version')), { code: 'ENOENT' });
    await rm(join(installed, '.env'));
    const retry = await cli(installed, ['update']);
    assert.equal(retry.code, 0, retry.stderr);
    assert.equal((await git(installed, 'rev-parse', 'HEAD')).stdout, (await git(upstream, 'rev-parse', 'HEAD')).stdout);
    assert.equal(await readFile(join(installed, '.env'), 'utf8'), 'upstream fixture data\n');
    assert.equal((await readFile(join(installed, 'build/version'), 'utf8')).trim(), '0.2.0');
    t.diagnostic(`$ poki update (collision removed by fixture owner)\n${retry.stdout}${retry.stderr}`);
  });
  const packaged = join(dir, 'package');
  await mkdir(packaged); await cp(join(installed, 'src'), join(packaged, 'src'), { recursive: true });
  await cp(join(installed, 'package.json'), join(packaged, 'package.json')); await copyCLI(packaged);
  const download = await cli(packaged, ['update']);
  assert.equal(download.code, 0, download.stderr); assert.match(download.stdout, /https:\/\/github.com\/JosssphZhou\/poki\/releases\/latest/);
  t.diagnostic(`$ poki update (prebuilt package)\n${download.stdout}`);
});
