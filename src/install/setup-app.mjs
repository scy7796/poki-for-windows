// Finds or installs Poki Setup for Mac: the newest PokiSetup-<version>-<build>-macos.dmg on the
// channel (same channel rule as desktop/core/src/release.rs), checked against SHA256SUMS-desktop.txt,
// Poki's Developer ID team and Apple's notarization before anything in it runs.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const REPO = 'JosssphZhou/poki';
export const TEAM_ID = 'Q64ZL36CJN';
const ORDER = ['stable', 'beta', 'alpha', 'pre-alpha'];
const BRIDGE = 'Contents/MacOS/poki-setup-bridge';

export class SetupError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ios-* and desktop-* tags, and Poki's app-* tags (app-0.2.9-prealpha.640, app-prealpha-latest,
// app-0.2.9-alpha.640, app-alpha-latest, app-0.3.0-beta.1, app-0.3.0).
export function channelOf(tag, prerelease) {
  const app = /^app-(.+)$/.exec(tag);
  if (app) {
    const rest = app[1];
    if (rest === 'prealpha-latest') return 'pre-alpha';
    if (rest === 'alpha-latest') return 'alpha';
    if (!/^\d/.test(rest)) return null;
    const suffix = rest.includes('-') ? rest.slice(rest.indexOf('-') + 1) : '';
    if (!suffix) return prerelease ? 'beta' : 'stable';
    if (suffix.startsWith('prealpha.')) return 'pre-alpha';
    if (suffix.startsWith('alpha.')) return 'alpha';
    return 'beta';
  }
  const rest = tag.replace(/^(ios|desktop)-/, '');
  if (rest === tag) return null;
  if (rest.startsWith('prealpha-')) return 'pre-alpha';
  if (rest.startsWith('alpha-')) return 'alpha';
  if (rest.startsWith('beta-')) return 'beta';
  if (rest.startsWith('v')) return prerelease ? 'beta' : 'stable';
  return null;
}

async function github(path) {
  const response = await request(`https://api.github.com/repos/${REPO}${path}`, 'application/vnd.github+json');
  return response.json();
}

// The newest macOS installer a channel offers, with the release that carries it.
export async function latestSetup(channel) {
  const allowed = ORDER.slice(0, ORDER.indexOf(channel) + 1);
  if (!allowed.length) throw new SetupError('unknown', `Unknown channel ${channel}; use ${ORDER.join(', ')}`);
  let best = null;
  for (const release of await github('/releases?per_page=40')) {
    if (release.draft || !allowed.includes(channelOf(release.tag_name, release.prerelease))) continue;
    for (const asset of release.assets) {
      const match = /^PokiSetup-(.+)-(\d+)-macos\.dmg$/.exec(asset.name);
      if (!match || (best && Number(match[2]) <= best.build)) continue;
      const sums = release.assets.find(a => a.name === 'SHA256SUMS-desktop.txt');
      best = { tag: release.tag_name, name: asset.name, version: match[1], build: Number(match[2]), url: asset.browser_download_url, apiUrl: asset.url, sums: sums?.browser_download_url, sumsApiUrl: sums?.url };
    }
  }
  if (!best) throw new SetupError('setup_download_failed', `No Poki Setup for macOS on the ${channel} channel`);
  if (!best.sums) throw new SetupError('setup_download_failed', `${best.tag} has no SHA256SUMS-desktop.txt`);
  return best;
}

async function request(url, accept, apiUrl, consume = response => response) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: accept, 'User-Agent': 'poki-install-iphone' }, signal: AbortSignal.timeout(120000) });
      if (response.ok) return await consume(response);
      last = `${url} answered ${response.status}`;
      if (response.status < 500) break;
      if (apiUrl) { url = apiUrl; accept = 'application/octet-stream'; }
    } catch (error) {
      last = `${url}: ${error.message}`;
      if (apiUrl) { url = apiUrl; accept = 'application/octet-stream'; }
    }
  }
  throw new SetupError('setup_download_failed', last);
}

async function download(url, file, apiUrl) {
  const bytes = await request(url, 'application/octet-stream', apiUrl, response => response.arrayBuffer());
  await writeFile(file, Buffer.from(bytes));
}

export async function downloadIpa(tag, downloads, ipaName) {
  const release = await github(`/releases/tags/${encodeURIComponent(tag)}`);
  const ipa = release.assets.find(a => ipaName ? a.name === ipaName : /^Poki-external-.+\.ipa$/.test(a.name));
  const signing = release.assets.find(a => a.name === 'Poki-signing.zip');
  const sums = release.assets.find(a => a.name === 'SHA256SUMS');
  if (!ipa || !signing || !sums) throw new SetupError('setup_download_failed', `${tag} needs an external IPA, Poki-signing.zip and SHA256SUMS`);
  await mkdir(downloads, { recursive: true });
  const dir = await mkdtemp(join(downloads, 'iphone-'));
  try {
    for (const asset of [sums, ipa, signing]) {
      if (asset.name.includes('/') || asset.name.includes('\\')) throw new SetupError('setup_download_failed', 'Invalid release asset name');
      await download(asset.browser_download_url, join(dir, asset.name), asset.url);
    }
    const hashes = new Map((await readFile(join(dir, sums.name), 'utf8')).trim().split('\n').map(line => {
      const [hash, name] = line.trim().split(/\s+/);
      return [name?.replace(/^\*/, ''), hash];
    }));
    for (const asset of [ipa, signing]) {
      const expected = hashes.get(asset.name);
      // Current releases list the IPA but not the signing archive in SHA256SUMS.
      if (!expected && asset === signing) continue;
      if (!expected || await sha256(join(dir, asset.name)) !== expected.toLowerCase()) throw new SetupError('setup_checksum_mismatch', `${asset.name} does not match SHA256SUMS`);
    }
    return join(dir, ipa.name);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Developer ID team and notarization; throws setup_signature_invalid otherwise.
export async function verifyApp(app) {
  try {
    await exec('codesign', ['--verify', '--deep', '--strict', app]);
    const { stderr } = await exec('codesign', ['-dv', '--verbose=2', app]);
    if (!stderr.includes(`TeamIdentifier=${TEAM_ID}`)) throw new Error(`not signed by team ${TEAM_ID}`);
    const assessed = await exec('spctl', ['-a', '-t', 'exec', '-vv', app]).catch(error => error);
    const text = `${assessed.stdout ?? ''}${assessed.stderr ?? ''}`;
    if (!/accepted/.test(text) || !/Notarized Developer ID/.test(text)) throw new Error(`Gatekeeper: ${text.trim()}`);
  } catch (error) {
    throw new SetupError('setup_signature_invalid', `${app}: ${error.stderr?.trim() || error.message}`);
  }
}

async function buildOf(app) {
  const { stdout } = await exec('plutil', ['-extract', 'CFBundleVersion', 'raw', join(app, 'Contents/Info.plist')]).catch(() => ({ stdout: '0' }));
  return Number(stdout.trim()) || 0;
}

// Where an installed Poki Setup can be: the folder run installs into, then ~/Applications, then
// /Applications. run, phones and diagnose all look here, so they agree.
export function setupAppRoots(into) {
  return [...new Set([into, join(homedir(), 'Applications'), '/Applications'].filter(Boolean))];
}

// The helper inside the Poki Setup that run used (recorded in run.json) or, failing that, the first
// installed one. Throws setup_app_missing with every place it looked.
export function findSetupBridge({ recorded, into, roots = setupAppRoots(into) } = {}) {
  if (recorded && existsSync(recorded)) return recorded;
  for (const dir of roots) {
    const bridge = join(dir, 'Poki Setup.app', BRIDGE);
    if (existsSync(bridge)) return bridge;
  }
  throw new SetupError('setup_app_missing', `Poki Setup.app is not in ${roots.join(', ')}${recorded ? ` and the helper the last run used (${recorded}) is gone` : ''}. Run \`node bin/install-iphone.mjs run\` to install it, or pass --app-dir or --bridge.`);
}

// Returns { app, bridge, build, source }. An app already in /Applications or ~/Applications is used
// when it is at least as new as the channel's; otherwise the release is installed into `into`.
export async function ensureSetupApp({ channel, into = join(homedir(), 'Applications'), downloads, onNote = () => {} }) {
  const release = await latestSetup(channel);
  for (const app of ['/Applications/Poki Setup.app', join(homedir(), 'Applications/Poki Setup.app'), join(into, 'Poki Setup.app')]) {
    if (!existsSync(join(app, BRIDGE))) continue;
    const build = await buildOf(app);
    if (build < release.build) { onNote(`${app} is build ${build}; the ${channel} channel has ${release.build}`); continue; }
    await verifyApp(app);
    return { app, bridge: join(app, BRIDGE), build, version: release.version, source: 'installed' };
  }
  await mkdir(downloads, { recursive: true });
  const dmg = join(downloads, release.name);
  const sumsFile = join(downloads, `${release.tag}-SHA256SUMS-desktop.txt`);
  for (let attempt = 0; ; attempt++) {
    onNote(`Downloading ${release.name} from ${release.tag}`);
    await download(release.url, dmg, release.apiUrl);
    await download(release.sums, sumsFile, release.sumsApiUrl);
    const want = (await readFile(sumsFile, 'utf8')).split('\n').map(line => line.trim().split(/\s+/)).find(([, name]) => name === release.name)?.[0];
    if (!want) throw new SetupError('setup_checksum_mismatch', `${release.name} is not listed in SHA256SUMS-desktop.txt`);
    if ((await sha256(dmg)) === want) break;
    await rm(dmg, { force: true });
    if (attempt >= 1) throw new SetupError('setup_checksum_mismatch', `${release.name} does not match SHA256SUMS-desktop.txt twice in a row`);
  }
  onNote('Checksum matches SHA256SUMS-desktop.txt');
  const mount = await mkdtemp(join(downloads, 'mount-'));
  await exec('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg]);
  try {
    const source = join(mount, 'Poki Setup.app');
    await verifyApp(source);
    onNote(`Signed by Developer ID team ${TEAM_ID} and notarized`);
    await mkdir(into, { recursive: true });
    const app = join(into, 'Poki Setup.app');
    await rm(app, { recursive: true, force: true });
    await exec('ditto', [source, app]);
    return { app, bridge: join(app, BRIDGE), build: release.build, version: release.version, source: release.tag };
  } finally {
    await exec('hdiutil', ['detach', mount, '-quiet']).catch(() => exec('hdiutil', ['detach', mount, '-force', '-quiet']).catch(() => {}));
    await rm(mount, { recursive: true, force: true }).catch(() => {});
  }
}
