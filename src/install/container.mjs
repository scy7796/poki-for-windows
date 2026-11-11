// Reading and writing Poki's hand-off files (Documents/PokiSetup/ in its container) from the Mac.
// Poki Setup's helper does it over the USB pairing when it has the container commands (newer than
// 0.2.1); otherwise Xcode's devicectl does, which can open a development-signed app's container.
// With neither, the installer falls back to asking the person.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const HELLO = 'poki-hello.json';
export const SEALED_KEY = 'model-key.json';
const missing = text => /not found|no such file|does not exist|ENOENT|kAFCObjectNotFound|ObjectNotFound|doesn.t exist/i.test(text);

function viaBridge(bridge, udid) {
  return {
    kind: 'Poki Setup',
    async read(name) {
      try {
        return Buffer.from(await bridge.request('container_read', { udid, name }), 'base64');
      } catch (error) {
        if (missing(error.message)) return null;
        throw error;
      }
    },
    write: (name, bytes) => bridge.request('container_write', { udid, name, data: Buffer.from(bytes).toString('base64') }),
  };
}

function viaDevicectl(udid, bundleId) {
  const base = ['devicectl', 'device', 'copy'];
  const where = ['--device', udid, '--domain-type', 'appDataContainer', '--domain-identifier', bundleId];
  const scratch = async run => {
    const dir = await mkdtemp(join(tmpdir(), 'poki-handoff-'));
    try { return await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
  };
  return {
    kind: 'devicectl',
    read: name => scratch(async dir => {
      try {
        await exec('xcrun', [...base, 'from', ...where, '--source', `Documents/PokiSetup/${name}`, '--destination', join(dir, name)]);
      } catch (error) {
        if (missing(`${error.stderr ?? ''}${error.stdout ?? ''}${error.message}`)) return null;
        throw error;
      }
      return readFile(join(dir, name)).catch(() => null);
    }),
    // Only sealed or non-secret files are written, and only for the moment devicectl needs them.
    write: (name, bytes) => scratch(async dir => {
      await writeFile(join(dir, name), bytes, { mode: 0o600 });
      await exec('xcrun', [...base, 'to', ...where, '--source', join(dir, name), '--destination', `Documents/PokiSetup/${name}`]);
    }),
    // Any Poki, also one too old to write a hello: a running process from Poki's install folder.
    running: () => scratch(async dir => {
      const json = async (what, ...more) => {
        const out = join(dir, `${what}.json`);
        await exec('xcrun', ['devicectl', 'device', 'info', what, '--device', udid, ...more, '--json-output', out]);
        return readFile(out, 'utf8');
      };
      const app = /file:\/\/\/[^"]+?\.app(?=\/?")/.exec(await json('apps', '--bundle-id', bundleId))?.[0];
      return !!app && (await json('processes')).includes(`${app}/`);
    }).catch(() => false),
  };
}

// The first way that works on this Mac, or null. The helper is asked once: an older one answers
// that it does not know the command, and any other answer means it does.
export async function containerAccess({ bridge, udid, bundleId }) {
  try {
    await bridge.request('container_read', { udid, name: HELLO });
    return viaBridge(bridge, udid);
  } catch (error) {
    if (!/unknown command/i.test(error.message)) return viaBridge(bridge, udid);
  }
  if (!bundleId) return null;
  try {
    await exec('xcrun', ['--find', 'devicectl']);
    return viaDevicectl(udid, bundleId);
  } catch {
    return null;
  }
}

export async function readHello(access) {
  const bytes = await access.read(HELLO).catch(() => null);
  if (!bytes) return null;
  try {
    const hello = JSON.parse(bytes);
    return hello?.schema === 'poki.hello/1' ? hello : null;
  } catch {
    return null;
  }
}
