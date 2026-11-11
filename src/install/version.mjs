// Which installer this is: the package version and the commit it was built from. Without git (a
// packaged copy) the commit comes from POKI_BUILD_COMMIT or build/commit, the same two places
// poki_mcp_status reads when git is missing.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { root } from '../config.mjs';

const exec = promisify(execFile);

async function commit() {
  const recorded = async () => process.env.POKI_BUILD_COMMIT?.trim() || (await readFile(join(root, 'build/commit'), 'utf8').catch(() => '')).trim() || 'unknown';
  try {
    return (await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, timeout: 2000 })).stdout.trim() || await recorded();
  } catch {
    return recorded();
  }
}

export async function installerVersion() {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  return { version, commit: await commit() };
}

export const installerLabel = ({ version, commit: sha }) => `${version} (${sha})`;

// Poki Setup's helper reports "0.2.1-319": version, then build.
export function setupLabel(text) {
  const match = /^(.+)-(\d+)$/.exec(text ?? '');
  return match ? `${match[1]} (${match[2]})` : text ?? null;
}
