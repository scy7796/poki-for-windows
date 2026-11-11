import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { MessageRunner } from './message-runner.mjs';
import { modelConfig, safeModelError } from './model-config.mjs';
import { checkDeviceTools } from './device-preflight.mjs';

export function reportChannelError(error) {
  let message = safeModelError(error);
  for (const key of ['BLUEBUBBLES_PASSWORD', 'TELEGRAM_BOT_TOKEN']) {
    if (process.env[key]) message = message.replaceAll(process.env[key], '[redacted]');
  }
  console.error(message);
  process.exitCode = 1;
}

export async function runMessageWorker(channel, Source) {
  const { values } = parseArgs({ options: {
    config: { type: 'string' }, state: { type: 'string' }, once: { type: 'boolean' },
    'step-timeout': { type: 'string' }, check: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log(`Usage: node agent/${channel === 'bluebubbles' ? 'imessage' : 'telegram'}.mjs --config <private JSON file> [--state <directory>] [--once] [--check]\n--check authenticates and reads only; no task or reply is sent.`);
    return;
  }
  if (!values.config) throw new Error('Pass --config with a private channel configuration file.');
  let config;
  try { config = JSON.parse(await readFile(values.config, 'utf8')); }
  catch { throw new Error('Cannot read the channel configuration as JSON.'); }
  const fields = ['sender', 'chatGuid', 'allowedUsers', 'device', 'model', 'auth', 'serviceTier', 'context', 'photos'];
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => !fields.includes(key))) throw new Error('Unsupported channel configuration. Keep credentials in environment variables.');
  // A string "true" would otherwise read as off without saying so, and iMessage has no photo path
  // at all: both are configuration mistakes, not preferences.
  if ('photos' in config) {
    if (channel !== 'telegram') throw new Error('photos is a Telegram setting; the iMessage channel sends no screenshots.');
    if (typeof config.photos !== 'boolean') throw new Error('Set photos to true or false.');
  }
  if (typeof config.device !== 'string' || !config.device.trim()) throw new Error('Configure one device before starting.');
  if (!values.check) { modelConfig(config); await checkDeviceTools(); }
  const stateDirectory = resolve(values.state ?? `agent/.runtime/${channel}`);
  const source = new Source({ ...config, stateDirectory });
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const lock = join(stateDirectory, 'messages.lock');
  try { await writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const { pid } = JSON.parse(await readFile(lock, 'utf8'));
    try { process.kill(pid, 0); throw new Error('A message worker already owns this state directory.'); }
    catch (check) {
      if (check.code !== 'ESRCH') throw check;
      await unlink(lock);
      await writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
    }
  }
  const runners = new Map();
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const ignorePipeError = () => {};
  process.stdout.on('error', ignorePipeError);
  process.stderr.on('error', ignorePipeError);
  process.on('SIGHUP', stop);
  const supervisedBy = Number(process.env.POKI_PARENT_PID ?? '');
  let watchdog;
  if (Number.isInteger(supervisedBy) && supervisedBy > 0 && !values.check) {
    watchdog = setInterval(() => {
      try { process.kill(supervisedBy, 0); } catch {
        console.log(`${channel}: supervisor ${supervisedBy} is gone, stopping.`);
        stop();
        return;
      }
      if (process.ppid !== supervisedBy) {
        console.log(`${channel}: reparented away from supervisor, stopping.`);
        stop();
      }
    }, 1500);
    watchdog.unref();
  }
  try {
    if (values.check) {
      await source.check(abort.signal);
      console.log(`${channel}: authentication and read check succeeded. No tasks or replies sent.`);
      return;
    }
    await source.open(abort.signal);
    console.log(`${channel}: ready. Only new messages from configured senders become tasks.`);
    do {
      for await (const message of await source.read(abort.signal)) {
        if (abort.signal.aborted) break;
        const key = message.conversation ?? 'direct';
        if (!runners.has(key)) runners.set(key, new MessageRunner(source.replyTo(message), {
          ...config, stepTimeout: values['step-timeout'], stateDirectory: key === 'direct' ? stateDirectory : join(stateDirectory, key),
        }));
        await runners.get(key).receive(message);
      }
      for (const runner of runners.values()) if (runner.failure) throw runner.failure;
      if (values.once) { await Promise.all([...runners.values()].map(runner => runner.finished)); break; }
      await setTimeout(channel === 'bluebubbles' ? 200 : 1000, undefined, { signal: abort.signal });
    } while (!abort.signal.aborted);
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally {
    if (watchdog) clearInterval(watchdog);
    try { await Promise.all([...runners.values()].map(runner => runner.close())); }
    finally {
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); process.removeListener('SIGHUP', stop);
      process.stdout.removeListener('error', ignorePipeError); process.stderr.removeListener('error', ignorePipeError);
      await unlink(lock);
    }
  }
}
