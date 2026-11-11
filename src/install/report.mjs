// When the install stops and the agent cannot fix it: a diagnostics bundle with identifiers and
// secrets removed, and an issue draft for the person to read. Nothing here submits anything.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { root } from '../config.mjs';
import { Bridge } from './bridge.mjs';
import { knownValues, redactText, redactValue, setupKnownValues } from './redact.mjs';
import { manifest } from './run.mjs';
import { findSetupBridge } from './setup-app.mjs';
import { installerLabel, installerVersion, setupLabel } from './version.mjs';

const exec = promisify(execFile);
const LOG_LINES = 40;
const quiet = async (file, args, opts = {}) => (await exec(file, args, { timeout: 8000, ...opts }).catch(error => ({ stdout: error.stdout ?? '', failed: true }))).stdout?.trim() ?? '';

export async function readRun(state) {
  try { return JSON.parse(await readFile(join(state, 'run.json'), 'utf8')); } catch { return null; }
}

async function tail(file) {
  if (!existsSync(file)) return null;
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean).slice(-LOG_LINES);
}

async function system() {
  const xcodePath = await quiet('xcode-select', ['-p']);
  // xcodebuild and python3 pop up the Command Line Tools installer when nothing is installed, so
  // they run only when xcode-select names a full Xcode.
  const xcode = xcodePath.includes('.app/') ? (await quiet('xcodebuild', ['-version'])).split('\n').join(' ') : xcodePath ? 'Command Line Tools only' : 'not installed';
  return {
    macos: `${await quiet('sw_vers', ['-productVersion'])} (${await quiet('sw_vers', ['-buildVersion'])})`,
    arch: await quiet('uname', ['-m']),
    xcode,
    node: process.version,
  };
}

// What usbmuxd, the USB bus, devicectl and Bonjour each see: the comparison issues #6 and #55 needed.
async function deviceView(bridgePath, setupHome) {
  const view = {};
  const usb = await quiet('ioreg', ['-p', 'IOUSB', '-w0']);
  view.usb_iphones = (usb.match(/\biPhone@/g) ?? []).length;
  if (bridgePath.error) view.usbmuxd_error = `${bridgePath.error.code ?? 'error'}: ${bridgePath.error.message}`;
  else {
    try {
      const { bridge } = await Bridge.start(bridgePath.path, { env: setupHome ? { POKI_SETUP_HOME: setupHome } : {} });
      try {
        const rows = await bridge.request('phones');
        view.usbmuxd = rows.map(r => ({ udid: r.phone.udid, name: r.facts?.name, link: r.phone.link?.kind, product_type: r.facts?.product_type, ios: r.facts?.ios, build: r.facts?.build, developer_mode: r.facts?.developer_mode, paired: r.facts?.paired_with_this_computer, can_pair_on_device: r.facts?.can_pair_on_device, error: r.error }));
        view.records = (await bridge.request('records')).map(r => ({ udid: r.udid, version: r.version, build: r.build, release_tag: r.release_tag, team_is_free: r.team_is_free, profile_expires_at: r.profile_expires_at, pairing_handed_off: r.pairing_handed_off, last_error: r.last_error }));
      } finally { bridge.close(); }
    } catch (error) { view.usbmuxd_error = `${error.kind ?? 'error'}: ${error.message}`; }
  }
  if ((await quiet('xcode-select', ['-p'])).includes('.app/')) {
    const listed = await quiet('xcrun', ['devicectl', 'list', 'devices', '--quiet', '--json-output', '/dev/stdout'], { timeout: 20000 });
    try { view.devicectl = JSON.parse(listed).result.devices.map(d => ({ udid: d.hardwareProperties?.udid, transport: d.connectionProperties?.transportType, tunnel: d.connectionProperties?.tunnelState, pairing: d.connectionProperties?.pairingState, ios: d.deviceProperties?.osVersionNumber, developer_mode: d.deviceProperties?.developerModeStatus })); } catch { view.devicectl = 'no answer'; }
  }
  const browse = await new Promise(resolve => {
    execFile('dns-sd', ['-B', '_remotepairing._tcp', 'local.'], { timeout: 3000 }, (_, stdout) => resolve(stdout ?? ''));
  });
  view.remotepairing_adverts = (browse.match(/\bAdd\b/g) ?? []).length;
  return view;
}

function setupHomes(state, record, setupHome) {
  return [setupHome, record?.setup_home, join(state, 'setup-home'), join(homedir(), 'Library/Application Support/nz.Poki.Poki-Setup')].filter(Boolean);
}

// The same Poki Setup run used, so the usbmuxd view is never silently missing.
function locate({ bridge, appDir, record }) {
  try { return { path: bridge ?? findSetupBridge({ recorded: record?.setup_bridge, into: appDir }) }; } catch (error) { return { error }; }
}

// Names that belong to the person: the Mac's names and the account holder's real name.
async function ownerNames() {
  const names = [hostname(), await quiet('scutil', ['--get', 'ComputerName']), await quiet('scutil', ['--get', 'LocalHostName']), await quiet('id', ['-F'])];
  return names.filter(name => name.length >= 3);
}

export async function diagnose({ state, noDevice, bridge, appDir, setupHome }) {
  const record = await readRun(state);
  const homes = setupHomes(state, record, setupHome);
  const logFile = homes.map(dir => join(dir, 'logs/poki-setup.log')).find(existsSync);
  const raw = {
    schema: 'poki.install-diagnostics/1',
    made_at: new Date().toISOString(),
    installer: await installerVersion(),
    system: await system(),
    poki_setup: setupLabel(record?.poki_setup),
    poki: record?.poki ?? null,
    channel: record?.channel ?? null,
    dry_run: record?.dry_run ?? false,
    steps: record?.steps ?? {},
    errors: record?.errors ?? [],
    waiting: record?.waiting ?? null,
    phones: record?.phones ?? [],
    devices: noDevice ? 'not read (--no-device)' : await deviceView(locate({ bridge, appDir, record }), setupHome ?? record?.setup_home),
    poki_setup_log: logFile ? await tail(logFile) : null,
    installer_log: await tail(join(state, 'bridge.log')),
  };
  const known = [...knownValues([record, raw.devices]), ...await setupKnownValues(homes), ...await ownerNames()];
  const bundle = redactValue(raw, known);
  bundle.removed = 'UDIDs, ECIDs, serials, device names, Apple Account emails, team names and ids, bundle ids, the Mac name, tokens, keys, passwords, pairing records, relay addresses, IP addresses and the macOS user name';
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  await writeFile(join(state, 'diagnostics.json'), text);
  return { bundle, text };
}

export async function issueDraft({ state }) {
  const file = join(state, 'diagnostics.json');
  const { bundle } = existsSync(file) ? { bundle: JSON.parse(await readFile(file, 'utf8')) } : await diagnose({ state, noDevice: true });
  const [stepId, failed] = Object.entries(bundle.steps).find(([, s]) => s.status === 'failed' || s.status === 'waiting') ?? ['unknown', { code: 'unknown', reason: 'The installer did not record a failed step.' }];
  const code = failed.code ?? (failed.status === 'waiting' ? `waiting for ${failed.wait}` : 'unknown');
  const step = manifest.steps.find(s => s.id === stepId);
  const title = `Install stops at ${step?.title ?? stepId}: ${code}`;
  const phone = bundle.phones?.[0];
  const stepLabel = { setup_app: 'Get Poki Setup', bridge: 'Start Poki Setup', channel: 'Start Poki Setup', apple_account: 'Sign in with the Apple Account', phone: 'Find the iPhone', open_poki: 'Trust the developer and open Poki', relay: 'Relay', check: 'Self-check' }[stepId]
    ?? (stepId === 'install' ? { trust_not_answered: 'Pair (Trust This Computer)', developer_mode_off: 'Developer Mode' }[code] ?? 'Sign and install Poki' : "Don't know");
  // Headings are the install-failure template's labels, so the draft reads like a form submission.
  const body = [
    '<!-- Drafted by node bin/install-iphone.mjs issue. Identifiers and secrets were removed; read it before you submit. -->',
    '### What happened', '',
    redactText(failed.reason ?? manifest.errors[code]?.reason ?? 'See the diagnostics below.'), '',
    '### Step it stopped at', '', stepLabel, '',
    '### Error code', '', `\`${code}\``, '',
    '### Install path', '', 'Agent installer (node bin/install-iphone.mjs)', '',
    '### What you or the agent tried', '',
    ...(bundle.errors?.length ? bundle.errors.map(e => `- \`${e.code}\`${e.retrying ? ' (retried)' : ''}: ${e.reason}`) : ['- Nothing beyond the run in the diagnostics.']),
    manifest.errors[code] ? `- The installer's fix for this code: ${manifest.errors[code].agent_fix}` : '', '',
    '### Diagnostics', '', '```json', JSON.stringify(bundle, null, 2), '```', '',
    '### Versions', '',
    `Poki installer ${bundle.installer ? installerLabel(bundle.installer) : 'unknown'}; Poki Setup ${bundle.poki_setup ?? 'unknown'} (channel ${bundle.channel ?? 'unknown'}); Poki ${bundle.poki ?? 'not installed'}; macOS ${bundle.system.macos} ${bundle.system.arch}; Xcode: ${bundle.system.xcode}; ${phone?.product_type ?? 'iPhone unknown'} on iOS ${phone?.ios ?? 'unknown'}${phone?.build ? ` (${phone.build})` : ''} over ${phone?.link ?? 'unknown'}`,
    '',
  ].join('\n');
  const draftFile = join(state, 'issue-draft.md');
  await writeFile(draftFile, body);
  const command = `gh issue create --repo JosssphZhou/poki --title ${JSON.stringify(title)} --body-file ${JSON.stringify(draftFile)} --label bug`;
  return { title, body, draftFile, command };
}
