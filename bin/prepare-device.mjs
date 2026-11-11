#!/usr/bin/env node
// Prepares a physical iPhone for Poki: developer mode, then Apple's developer disk image.
//
// On macOS the image comes from Xcode. Elsewhere it has to be obtained another way,
// so this helper accepts --image DIR or POKI_DDI_DIR holding an unpacked DDI Restore directory,
// installs it with cryptexd, and falls back to pymobiledevice3's own downloader.
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { root, idevice, noUsbDevice } from '../src/config.mjs';
import { signingRefused, ddiRecovery } from '../src/ddi-failure.mjs';
import { isWin, python } from '../src/os.mjs';

const fail = message => { console.error(message); process.exit(1); };
const execute = promisify(execFile);
const { values: options, positionals } = parseArgs({ allowPositionals: true, options: {
  image: { type: 'string' }, 'enable-developer-mode': { type: 'boolean' } } });
const { stdout } = await execute(python, [join(root, 'native/devices.py')], { timeout: 8000 });
const ids = [...new Set(JSON.parse(stdout).map(d => d.id).filter(Boolean))];
if (!ids.length) fail(noUsbDevice);
const selected = positionals[0] ?? (ids.length === 1 ? ids[0] : undefined);
if (!selected || !ids.includes(selected)) fail('Connect one unlocked, trusted iPhone, or pass a connected device id.');
const call = async (args, extra = {}) => execute(idevice, ['--udid', selected, ...args], { timeout: 180000, maxBuffer: 8 * 1024 * 1024, ...extra });
const display = 'com.apple.coredevice.displayservice';
const services = async () => (await call(['remotexpc'])).stdout;
const newerImage = isWin
  ? `Use the developer disk image of an Xcode release that supports this iOS version, copied from a Mac, or pass a newer Apple-signed Cryptex image: node bin/prepare-device.mjs ${selected} --image DIR.`
  : `Use the developer disk image of an Xcode release that supports this iOS version, or pass a newer Apple-signed Cryptex image: node bin/prepare-device.mjs ${selected} --image DIR.`;
const restart = isWin
  ? 'Restart the iPhone, reconnect it over USB, unlock it, and run this command again.'
  : 'Quit Xcode, restart the iPhone, reconnect it over USB, unlock it, and run this command again with Xcode closed.';
const installFailures = [
  [/BadBuildManifest/, () => `Its BuildManifest.plist has no build identity whose variant ends with "Developer Disk Image Cryptex", the only form the installer accepts. Older images, such as the one in Xcode 26.6 (17F113), use a variant containing "Cryptex Developer Disk Image" instead. ${newerImage}`],
  [/\/System\/Developer \[17: File exists\]/, () => `Another developer disk image is already mounted at /System/Developer on the iPhone. ${restart}`],
];

async function identity() {
  const read = async key => JSON.parse((await call(['lockdown', 'get', key])).stdout);
  return { name: await read('DeviceName'), model: await read('ProductType'), ios: await read('ProductVersion') };
}

async function developerMode(device) {
  const status = (await call(['amfi', 'status'])).stdout.trim();
  if (/true/i.test(status)) return 'enabled';
  // Making the toggle visible is harmless and lets a person find it.
  await call(['amfi', 'show']).catch(() => {});
  // Turning it on remotely is a change to the device, so it only happens when asked for.
  // It is refused anyway while the phone has a passcode.
  if (!options['enable-developer-mode']) {
    return `needs a person: open Settings > Privacy & Security > Developer Mode on ${device.name}, turn it on, and restart the phone. Pass --enable-developer-mode to attempt it from here.`;
  }
  const attempt = await call(['amfi', 'enable']).then(() => '', error => String(error.stderr ?? error.message));
  if (/passcode/i.test(attempt)) {
    return `needs a person: open Settings > Privacy & Security > Developer Mode on ${device.name}, turn it on, and restart the phone. (Enabling it remotely is refused while a passcode is set.)`;
  }
  if (attempt) return `needs a person: turn on Developer Mode in Settings > Privacy & Security and restart the phone. ${attempt.split('\n').at(-1)}`;
  return 'enabled remotely; restart the phone if the setting asks for it';
}

// Xcode ships the image, so a Mac uses it before anything else. --image or POKI_DDI_DIR points at an
// unpacked DDI Restore directory for hosts that have none.
const XCODE_DDI = '/Library/Developer/DeveloperDiskImages/iOS_DDI/Restore';

async function removableDirectory() {
  if (options.image) {
    const image = resolve(options.image);
    await access(join(image, 'BuildManifest.plist')).catch(() => fail(`${image} has no BuildManifest.plist. Pass the directory that holds the image's BuildManifest.plist and its payloads.`));
    return image;
  }
  const candidates = [];
  if (process.platform === 'darwin') candidates.push(XCODE_DDI);
  if (process.env.POKI_DDI_DIR) candidates.push(process.env.POKI_DDI_DIR);
  for (const candidate of candidates) {
    const present = await access(join(candidate, 'BuildManifest.plist')).then(() => true, () => false);
    if (present) return candidate;
  }
  return undefined;
}

async function installFrom(image) {
  console.log(`Installing the Apple-signed developer disk image from ${image} on the selected device…`);
  const result = await call(['cryptexd', 'install-ddi', image]).catch(async error => {
    const output = `${error.stderr ?? ''}\n${error.stdout ?? ''}`;
    if (signingRefused(output)) {
      const ios = await call(['lockdown', 'get', 'ProductVersion']).then(({ stdout }) => JSON.parse(stdout), () => null).catch(() => null);
      const status = output.match(/STATUS=94[^)\n]*/)?.[0];
      fail(`Installing ${image} failed. ${await ddiRecovery(ios)}${status ? ` (${status})` : ''}`);
    }
    for (const [pattern, explain] of installFailures) {
      const match = output.match(pattern);
      if (match) fail(`Installing ${image} failed. ${explain(match[1])}`);
    }
    fail(`Installing ${image} failed: ${output.trim().split('\n').slice(-3).join(' ')}`);
  });
  if (!/installed com\.apple\.MobileAsset\.DDI|is already installed/.test(result.stdout)) fail(`The device did not confirm installation: ${result.stdout.slice(-1500)}`);
}

async function diskImage() {
  if ((await services().catch(() => '')).includes(display)) return 'display service is already available';
  console.log(`The iPhone does not provide ${display}, which touch and text input need. Screenshots and accessibility work without it.`);
  const restore = await removableDirectory();
  if (restore) await installFrom(restore);
  else {
    // pymobiledevice3 downloads the personalized image Apple signs for this phone.
    const result = await execute(python, ['-m', 'pymobiledevice3', 'mounter', 'auto-mount'], { timeout: 900000, maxBuffer: 8 * 1024 * 1024 }).then(outcome => outcome, error => ({ stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? error.message) }));
    if (!/mounted|already/i.test(result.stdout + result.stderr)) fail(`Mounting the developer disk image failed. Pass --image DIR or set POKI_DDI_DIR to an unpacked DDI Restore directory, or install pymobiledevice3 and let it download one. ${(result.stderr || result.stdout).slice(-1500)}`);
  }
  if (!(await services()).includes(display)) {
    fail(`A developer disk image is installed, but it does not provide ${display}. Check that Developer Mode and UI Automation are on in Developer settings. The installed image may be older than this iOS version needs. ${newerImage} ${restart}`);
  }
  return 'developer disk image installed; the device now exposes displayservice';
}

const device = await identity();
console.log(JSON.stringify({ device }, null, 2));
console.log(`Developer mode: ${await developerMode(device)}`);
if (isWin && !options.image && !process.env.POKI_DDI_DIR) console.log('If the developer image below fails, obtain it from a Mac whose Xcode matches this iOS version and pass --image DIR, or set POKI_DDI_DIR, to its iOS_DDI/Restore directory.');
console.log(`Developer disk image: ${await diskImage()}`);
