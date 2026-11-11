// Reads Poki's chats, voice conversations and log off an iPhone over USB, read-only, and writes them
// as one text file in time order. devicectl copies them out of Poki's app container; nothing on the
// phone changes. Keys, pairing records and relay addresses never reach the file (redactText).
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { redactText } from './redact.mjs';

const exec = promisify(execFile);
const SESSIONS = 'Library/Application Support/Poki/Sessions';
const LOG = 'Library/Caches/poki-log.txt';
// Swift's JSONEncoder writes a Date as seconds since 2001-01-01 (SessionStore uses .deferredToDate).
const REFERENCE_DATE = Date.UTC(2001, 0, 1);

export class RecordsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function devicectl(args, timeout = 120000) {
  const dir = await mkdtemp(join(tmpdir(), 'poki-records-json-'));
  try {
    await exec('xcrun', ['devicectl', ...args, '--quiet', '--json-output', join(dir, 'out.json')], { timeout, maxBuffer: 16 << 20 });
    return JSON.parse(await readFile(join(dir, 'out.json'), 'utf8')).result ?? {};
  } catch (error) {
    const reason = String(error.stderr || error.message).trim().split('\n').slice(-3).join(' ');
    throw new RecordsError('devicectl_failed', `devicectl ${args.slice(0, 3).join(' ')} failed: ${redactText(reason)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function choosePhone(udid) {
  const devices = (await devicectl(['list', 'devices'])).devices ?? [];
  const phones = devices.filter(d => d.hardwareProperties?.platform === 'iOS' && d.connectionProperties?.transportType === 'wired');
  if (udid) {
    if (!devices.some(d => d.hardwareProperties?.udid === udid)) throw new RecordsError('phone_missing', 'devicectl does not see the iPhone given with --udid. Plug it in over USB and unlock it.');
    return udid;
  }
  if (phones.length === 0) throw new RecordsError('phone_missing', 'No iPhone is connected over USB. Plug it in, unlock it and accept Trust This Computer.');
  if (phones.length > 1) throw new RecordsError('several_phones', `Several iPhones are connected over USB. Choose one with --udid (node bin/install-iphone.mjs phones lists them).`);
  return phones[0].hardwareProperties.udid;
}

// Poki's bundle id carries the signing team (nz.zheha.poki.<team>); the extensions and Poki Setup's
// runner have longer ids or other names.
async function findPoki(udid, bundle) {
  if (bundle) return { bundle, version: '?' };
  const apps = (await devicectl(['device', 'info', 'apps', '--device', udid])).apps ?? [];
  const poki = apps.filter(a => /^nz\.zheha\.poki\.[A-Z0-9]+$/.test(a.bundleIdentifier ?? '') && a.name === 'Poki');
  if (poki.length === 0) throw new RecordsError('poki_missing', 'Poki is not installed on this iPhone (or iOS does not list it). Install it first: node bin/install-iphone.mjs run');
  const app = poki[0];
  return { bundle: app.bundleIdentifier, version: `${app.version ?? '?'} (${app.bundleVersion ?? '?'})`, others: poki.length - 1 };
}

async function copyFrom(udid, bundle, source, destination) {
  try {
    await devicectl(['device', 'copy', 'from', '--device', udid, '--domain-type', 'appDataContainer', '--domain-identifier', bundle, '--source', source, '--destination', destination]);
    return true;
  } catch (error) {
    // A Poki that never saved a chat or a log has no such file yet (devicectl: "Failed to retrieve the
    // file node for <path> (com.apple.dt.CoreDeviceError error 7000)").
    if (/Failed to retrieve the file node|error 7000/.test(error.message)) return false;
    throw error;
  }
}

async function jsonFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await jsonFiles(path));
    else if (entry.name.endsWith('.json')) found.push(path);
  }
  return found;
}

const toDate = value => typeof value === 'number' ? new Date(REFERENCE_DATE + value * 1000) : typeof value === 'string' ? new Date(value) : null;
const pad = n => String(n).padStart(2, '0');
const day = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// One ChatEntry (ChatModel.swift) as "who: what". Swift encodes an enum case with associated values
// as {case: {_0: first, label: value}}.
function entryLine(kind) {
  const [name, value = {}] = Object.entries(kind ?? {})[0] ?? [];
  const first = value._0;
  switch (name) {
    case 'time': return null;
    case 'you': return `You: ${first}`;
    case 'poki': return `Poki: ${first}`;
    case 'request': return `${value.from ?? 'An agent'} asked Poki: ${first}`;
    case 'step': return `  · ${first}${value.ok === false ? ' (failed)' : value.ok == null ? ' (running)' : ''}`;
    case 'plan': return `  Plan: ${(first ?? []).map(s => `${s.text} [${s.state}]`).join('; ')}`;
    case 'note': {
      const [note, detail = {}] = Object.entries(first ?? {})[0] ?? [];
      return `  (${note}${detail._0 && typeof detail._0 === 'string' ? `: ${detail._0}` : ''})`;
    }
    default: return name ? `  (${name})` : null;
  }
}

const KIND = { poki: 'Chat with Poki', voice: 'Voice conversation', agent: 'Agent session', handoff: 'Task from an agent' };

export function formatSession(session) {
  const started = toDate(session.started);
  const name = session.customName || session.autoName || session.title || session.client || '';
  const head = `== ${started ? `${day(started)} ${clock(started)}` : '?'}  ${KIND[session.kind] ?? session.kind}${session.client ? ` (${session.client})` : ''}${name ? `: ${name}` : ''}${session.outcome ? `  [${session.outcome}]` : ''}`;
  const lines = [head];
  let lastDay = started && day(started);
  for (const entry of session.entries ?? []) {
    const at = toDate(entry.at);
    const kind = Object.keys(entry.kind ?? {})[0];
    if (kind === 'time') {
      const when = toDate(entry.kind.time._0);
      if (when) { lines.push(`-- ${day(when)} ${clock(when)}`); lastDay = day(when); }
      continue;
    }
    const text = entryLine(entry.kind);
    if (!text) continue;
    if (at && day(at) !== lastDay) { lines.push(`-- ${day(at)}`); lastDay = day(at); }
    lines.push(`${at ? clock(at) : '        '}  ${text.replaceAll('\n', '\n          ')}`);
  }
  if (session.calls?.length) {
    lines.push(`   tool calls (${session.calls.length}):`);
    for (const c of session.calls) lines.push(`   - ${c.name} ${c.arguments} → ${c.ok ? 'ok' : 'failed'} in ${c.ms} ms`);
  }
  return lines.join('\n');
}

// Everything copied, as one text: sessions oldest first, then Poki's own log (which keeps times of
// day only, oldest first, and was written last on `logWritten`).
export function formatRecords({ sessions, log, logWritten, poki, known = [], now = new Date() }) {
  const sorted = [...sessions].sort((a, b) => (toDate(a.started) ?? 0) - (toDate(b.started) ?? 0));
  const parts = [
    `Poki records, read from the iPhone over USB on ${day(now)} ${clock(now)} (Mac time zone).`,
    `Poki ${poki.version}. ${sorted.length} conversation${sorted.length === 1 ? '' : 's'}, ${log ? log.split('\n').filter(Boolean).length : 0} log lines. Keys, pairing records, relay addresses and the phone's identifiers are removed.`,
    '',
    ...sorted.map(s => `${formatSession(s)}\n`),
    `== Poki log${logWritten ? ` (times of day; last written ${day(logWritten)} ${clock(logWritten)})` : ''}`,
    log ? log.trimEnd() : '(no log on the phone)',
    '',
  ];
  return redactText(parts.join('\n'), known);
}

export async function readRecords({ udid, bundle, out, state }) {
  const phone = await choosePhone(udid);
  const poki = await findPoki(phone, bundle);
  const work = await mkdtemp(join(tmpdir(), 'poki-records-'));
  try {
    // devicectl makes the folder itself, as the phone's Sessions folder.
    const sessionsDir = join(work, 'Sessions');
    await copyFrom(phone, poki.bundle, SESSIONS, sessionsDir);
    const logFile = join(work, 'poki-log.txt');
    const hasLog = await copyFrom(phone, poki.bundle, LOG, logFile);
    const sessions = [];
    for (const file of await jsonFiles(sessionsDir)) {
      try { sessions.push(JSON.parse(await readFile(file, 'utf8'))); } catch { /* a file being written as it was copied */ }
    }
    const log = hasLog ? await readFile(logFile, 'utf8').catch(() => '') : '';
    const logWritten = hasLog ? (await stat(logFile).catch(() => null))?.mtime : undefined;
    const text = formatRecords({ sessions, log, logWritten, poki, known: [phone, poki.bundle] });
    const now = new Date();
    const file = out ?? join(state, 'records', `poki-records-${day(now)}-${clock(now).replaceAll(':', '')}.txt`);
    await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
    await writeFile(file, text, { mode: 0o600 });
    await chmod(file, 0o600);
    return { file, sessions: sessions.length, logLines: log.split('\n').filter(Boolean).length, poki };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
