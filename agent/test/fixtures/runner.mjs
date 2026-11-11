import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskServices } from './task-services.mjs';

export async function runnerFixture(t, options = {}) {
  const { MessageRunner } = await import('../../message-runner.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'poki-return-'));
  const services = await taskServices(join(directory, 'mcp'), { route: true, ...options });
  const before = { ...process.env };
  Object.assign(process.env, { IDEVICE_TOOLS: process.execPath, OPENAI_API_KEY: 'sk-local-channel-fixture',
    OPENAI_BASE_URL: services.modelURL, POKI_MCP_STATE_DIR: join(directory, 'mcp') });
  delete process.env.POKI_AGENT_SERVICE_TIER;
  const replies = [];
  const source = { progressStyle: 'opening', acknowledge: async () => {}, send: async (text, metadata) => {
    replies.push(text);
    services.events.push({ type: metadata?.kind === 'final' ? 'delivered' : 'opening', foreground: services.foreground });
  } };
  const runner = new MessageRunner(source, { stateDirectory: join(directory, 'state'), device: 'synthetic-device', model: 'gpt-5.4', auth: 'api-key' });
  t.after(async () => {
    t.mock.timers.reset();
    await runner.close(); await services.close();
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
    await rm(directory, { recursive: true, force: true });
  });
  return { runner, services, source, replies };
}
