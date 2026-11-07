// Ported from GitHub CLI v2.83.0, internal/update/update.go (MIT).
// https://github.com/cli/cli/blob/152d328db80d4d4d7318c7700b6644ee827618a7/internal/update/update.go
// Copyright (c) 2019 GitHub Inc. See third_party/LICENSE.github-cli.
// Poki uses JSON, anonymous requests, cached notices, and silent failures for MCP clients.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { stateDir } from './config.mjs';
import { version } from './build-info.mjs';

const day = 24 * 60 * 60 * 1000;
const stateFile = join(stateDir, 'update-check.json');
// This port has its own releases; upstream's would point Windows users at a macOS build.
const repo = 'scy7796/poki-for-windows';
const endpoint = `https://api.github.com/repos/${repo}/releases/latest`;
const updateCommand = 'git pull --ff-only, then ./bin/setup.ps1';
let pending;
let state;

function versionParts(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(value ?? '');
  return match && { numbers: match.slice(1, 4).map(Number), prerelease: match[4] };
}

function notice(release) {
  const latest = versionParts(release?.tag_name), current = versionParts(version);
  if (!latest || !current || latest.prerelease || release.draft || release.prerelease) return;
  const difference = latest.numbers.map((n, i) => n - current.numbers[i]).find(n => n !== 0) ?? 0;
  if (difference < 0 || (difference === 0 && !current.prerelease)) return;
  const firstLine = String(release.body ?? '').split(/\r?\n/).map(line => line.trim()).find(line => line && !/^#{1,6}\s/.test(line)) ?? '';
  const summary = firstLine.replace(/^[-*+]\s+/, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').match(/^.*?[.!?](?:\s|$)|^.+$/)?.[0].trim() ?? '';
  return { version: latest.numbers.join('.'), summary: summary.slice(0, 300), url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(release.tag_name)}`, command: updateCommand };
}

async function checkForUpdate() {
  state ??= await readFile(stateFile, 'utf8').then(JSON.parse).catch(() => null);
  const age = Date.now() - state?.checkedAt;
  if (Number.isFinite(age) && age >= 0 && age < day) return notice(state.release);
  let release = null;
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'poki-update-check' },
      signal: AbortSignal.timeout(1500), redirect: 'error',
    });
    if (response.ok) release = await response.json();
  } catch {}
  state = { checkedAt: Date.now(), release };
  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, stateFile);
  } catch {}
  return notice(release);
}

export async function updateNotice() {
  if (process.env.POKI_NO_UPDATE_CHECK === '1') return;
  pending ??= checkForUpdate().catch(() => undefined).finally(() => { pending = undefined; });
  return pending;
}

export function startUpdateChecks() {
  void updateNotice();
  const timer = setInterval(() => { void updateNotice(); }, day);
  timer.unref();
  return () => clearInterval(timer);
}
