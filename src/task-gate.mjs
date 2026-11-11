import { z } from 'zod';

// Per-task approval for MCP clients that act on a person's own phone. With POKI_MCP_TASK_APPROVAL=1,
// every device tool except the ones in `open` is refused until the client calls begin_task and the
// person accepts the elicitation it raises. One acceptance covers the whole task: it lasts until
// end_task, until the lease sits idle for idleMs, or until maxMs after approval, whichever is first.
// A client without elicitation support cannot obtain a lease, so the gate fails closed.
// Handlers are not serialized, so an answer can arrive after end_task or after a newer begin_task.
// Both bump `generation`, and an answer to an older request is ignored instead of opening a lease.
export const taskGateEnabled = (env = process.env) => env.POKI_MCP_TASK_APPROVAL === '1';

const open = new Set(['poki_mcp_status', 'list_devices', 'begin_task', 'end_task']);
const minutes = (value, fallback) => {
  const n = Number(value);
  return (Number.isFinite(n) && n > 0 ? n : fallback) * 60_000;
};

export const taskGateDefinitions = [
  ['begin_task', 'Ask the phone owner to approve one task before using any device tool. Pass a short plain-language description of the whole task (what app, what you will do, what you will type or send). The owner sees it and accepts or declines. Every other device tool is refused until this succeeds. One approval covers the task until end_task, ten idle minutes, or one hour. Start a new begin_task for a different task; never split one task to avoid review or widen a task beyond what was approved.', z.object({ task: z.string().min(1).max(500) }), false],
  ['end_task', 'End the approved task so later device calls need a new approval. Call it as soon as the approved task is done or abandoned.', z.object({}), false],
];

export function createTaskGate({ env = process.env, now = () => Date.now() } = {}) {
  const idleMs = minutes(env.POKI_MCP_TASK_IDLE_MINUTES, 10);
  const maxMs = minutes(env.POKI_MCP_TASK_MAX_MINUTES, 60);
  const approvalTimeoutMs = minutes(env.POKI_MCP_TASK_APPROVAL_TIMEOUT_MINUTES, 9);
  let lease = null;
  let generation = 0;
  let server = null;
  const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
  const refuse = message => ({ isError: true, content: [{ type: 'text', text: message }] });
  const live = () => {
    if (!lease) return null;
    const t = now();
    if (t - lease.lastUsed > idleMs || t - lease.approvedAt > maxMs) {
      lease = null;
      return null;
    }
    return lease;
  };

  async function beginTask({ task }, signal) {
    lease = null;
    const mine = ++generation;
    let result;
    try {
      result = await server.server.elicitInput({
        mode: 'form',
        message: `${env.POKI_MCP_TASK_APPROVAL_CLIENT || 'An MCP client'} wants to use your iPhone for this task:\n${task}\n\nIf you approve, it will not ask again until the task ends, sits idle for ${idleMs / 60_000} minutes, or reaches ${maxMs / 60_000} minutes.`,
        requestedSchema: { type: 'object', properties: {} },
      }, { timeout: approvalTimeoutMs, signal });
    } catch (error) {
      return refuse(`The approval request could not be completed (${error.message}). No device tool will run. Do not retry without the owner asking.`);
    }
    if (mine !== generation) {
      return refuse('This approval request was ended by end_task or replaced by a newer begin_task before the owner answered, so the answer was ignored. It approved nothing.');
    }
    if (result?.action !== 'accept') {
      return refuse(`The owner did not approve this task (${result?.action ?? 'no answer'}). No device tool will run. Do not retry without the owner asking.`);
    }
    const t = now();
    lease = { task, approvedAt: t, lastUsed: t };
    return text({ approved: true, task, idle_minutes: idleMs / 60_000, max_minutes: maxMs / 60_000 });
  }

  return {
    attach(mcpServer) { server = mcpServer; },
    get lease() { return live(); },
    // Returns a tool result for gate tools and refusals, or null when the call may go to the device.
    async check(name, args, signal) {
      if (name === 'begin_task') return beginTask(args, signal);
      if (name === 'end_task') {
        const ended = live();
        lease = null;
        generation += 1;
        return text({ ended: Boolean(ended), task: ended?.task ?? null });
      }
      if (open.has(name)) return null;
      const current = live();
      if (!current) return refuse(`'${name}' was refused: no approved task. Call begin_task with a description of the whole task and wait for the owner to approve it.`);
      current.lastUsed = now();
      return null;
    },
  };
}
