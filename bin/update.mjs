#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../src/config.mjs';
import { isWin } from '../src/os.mjs';

// The installer is a shell script on macOS and a PowerShell script elsewhere, so the
// update runs whichever one this host can execute.
function build() {
  if (isWin) run('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'bin/setup.ps1')]);
  else run('./bin/setup', []);
}

const args = process.argv.slice(2);
if (args.length) {
  console.log('Usage: poki update\nUpdate a clean main checkout, or show prebuilt package download instructions.');
  process.exit(args.length === 1 && ['--help', '-h'].includes(args[0]) ? 0 : 1);
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Git could not inspect this checkout. Check that Git is installed and the repository is readable.');
  return result.stdout.trim();
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed. Resolve the error above and run poki update again. The service was not restarted.`);
}

try {
  if (!existsSync(join(root, '.git'))) {
    console.log('This copy is not a Git checkout, so it cannot update itself. Clone the current version into a new directory:\ngit clone https://github.com/scy7796/poki-for-windows.git\nInstall it as its AGENTS.md describes, stop your existing service, and point your MCP client at the new directory.\nKeep your existing POKI_MCP_STATE_DIR. The current installation was not changed.');
  } else {
    if (realpathSync(git('rev-parse', '--show-toplevel')) !== realpathSync(root)) throw new Error('Poki must be at the root of its own Git checkout.');
    if (git('branch', '--show-current') !== 'main') throw new Error('Update stopped: this checkout is not on main. Switch to main yourself before updating.');
    if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Update stopped: this checkout has local changes. Commit or stash them yourself before updating.');
    console.log('Fetching Poki updates...');
    run('git', ['fetch']);
    console.log('Fast-forwarding Poki without overwriting ignored files...');
    run('git', ['merge', '--ff-only', '--no-overwrite-ignore', '@{upstream}']);
    console.log(`Building Poki with ${isWin ? 'bin/setup.ps1' : './bin/setup'}...`);
    build();
    console.log('Poki updated. Stop the existing service and restart it with npm start. The service was not restarted automatically.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
