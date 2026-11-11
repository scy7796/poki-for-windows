import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../bin/prepare-device.mjs', import.meta.url));
const panic = (line, detail) => `thread 'main' panicked at tools/src/cryptexd.rs:${line}:18:\n${detail}\nnote: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace`;
const failures = [
  ['an image whose manifest the installer cannot read', panic(159, 'failed to load the DDI assets: BadBuildManifest'), /Developer Disk Image Cryptex/],
  ['Apple declining to sign the image', panic(186, `install failed: UnexpectedResponse("TSS server responded with non-success status (STATUS=94&MESSAGE=This device isn't eligible for the requested build.)")`), /declined.*STATUS=94&MESSAGE=This device isn't eligible for the requested build\./],
  ['another image mounted at /System/Developer', panic(186, 'install failed: UnexpectedResponse("com.apple.MobileAsset.DDI: mkdir custom mount path: /System/Developer [17: File exists] (com.apple.security.cryptex.posix: 17)")'), /restart the iPhone/],
];

for (const [name, output, explanation] of failures) {
  test(`prepare-device explains ${name} instead of printing the installer panic`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'poki-prepare-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const image = join(dir, 'Restore');
    await mkdir(join(dir, 'bin'));
    await mkdir(image);
    await writeFile(join(image, 'BuildManifest.plist'), '');
    await writeFile(join(dir, 'bin/python3'), `#!/bin/sh\necho '[{"id":"fixture-phone","connection":"USB"}]'\n`, { mode: 0o755 });
    await writeFile(join(dir, 'bin/idevice'), `#!/bin/sh\ncase "$3" in\n  remotexpc) echo com.apple.dt.testmanagerd.remote ;;\n  lockdown) echo '\"27.2\"' ;;\n  cryptexd) printf '%s\\n' "$INSTALL_OUTPUT" >&2; exit 101 ;;\nesac\n`, { mode: 0o755 });
    await writeFile(join(dir, 'bin/xcodebuild'), '#!/bin/sh\necho "Xcode 26.6"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, IDEVICE_TOOLS: join(dir, 'bin/idevice'), INSTALL_OUTPUT: output };
    const failed = await run(process.execPath, [script, 'fixture-phone', '--image', image], { env }).then(() => assert.fail('preparation succeeded'), error => error);
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, explanation);
    if (name === 'Apple declining to sign the image') {
      for (const pattern of [/Xcode 26\.6/, /iOS 27\.2/, /Update Xcode/, /iOS 27 requires Xcode 27/, /Open Xcode once/, /components/, /rerun the same command/, /Poki does not need to be reinstalled/]) assert.match(failed.stderr, pattern);
    }
    assert.match(failed.stderr, new RegExp(image.replaceAll('/', '\\/')));
    assert.doesNotMatch(failed.stderr, /panicked|at file:/);
  });
}

test('prepare-device sends the user to Finder when usbmuxd answers with no device', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'poki-prepare-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'bin'));
  await writeFile(join(dir, 'bin/python3'), `#!/bin/sh\necho '[]'\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, IDEVICE_TOOLS: join(dir, 'bin/idevice') };
  const failed = await run(process.execPath, [script], { env }).then(() => assert.fail('preparation succeeded'), error => error);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /Finder sidebar/);
  assert.match(failed.stderr, /devicectl reaches only over the network/);
});
