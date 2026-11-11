// Source: poki-app gateway/fast/run.mjs at 9972d34.
// Source: poki-mcp/client/fast/run.mjs. The plan loop is retained; App owns model handoff.
import { FastSession } from './session.mjs';
import { candidatesFor, succeeded, conditionsMatch, matching } from './task.mjs';
import { reusableActionObservation } from '../post-action-observation.mjs';

// Tapping the status bar scrolls a page to its top. The bar is the band above the app's first element, never
// taller than a twentieth of the screen; its left part holds the clock, clear of a notch or Dynamic Island.
function statusBar({ width, height, elements }) {
  const top = Math.min(height / 20, ...elements.map(e => (e.frame ?? e).y).filter(y => y > 0));
  return Number.isFinite(width) && top > 0 ? { x: Math.round(width * 0.15), y: Math.round(top / 2) } : null;
}
// A fingerprint of what a screen shows, to tell whether going back reached another page.
const fingerprint = observation => JSON.stringify(observation.elements.map(e => [e.role ?? e.type, e.label ?? e.text]));
const returnLimit = 4;
// The replay observes the screen after every input and checks it against the step, so an input need not read the screen back itself.
const unverified = new Set(['tap', 'scroll', 'swipe', 'go_back']);
const reasons = new Set(['device_unavailable', 'tool_failed', 'tool_protocol', 'unknown_outcome', 'scope_unavailable', 'outside_scope', 'structure_unavailable', 'stale_observation', 'ambiguous_target', 'no_candidates', 'step_precondition_failed', 'step_not_completed', 'final_condition_failed', 'task_changed']);
export async function runFast({ task, alternatives = [], onSelect = () => {}, call, releaseLease = true, signal = new AbortController().signal }) {
  const mode = 'plan';
  const started = performance.now();
  const stats = { mode, provider: null, model: null, model_calls: 0, model_ms: 0, tool_calls: 0, tool_ms: 0, scope_ms: 0, action_count: 0, scope_launch_count: 0, return_count: 0, total_ms: 0 };
  let session, lease, observation, nextObservation, lastAction, pending = false, reason = null, status = 'handoff', previousPage, scrolledToTop = false;
  const history = [], observedIds = new Set();
  let scopePid;
  const checkpoint = () => ({
    bundle_id: task.bundle_id, completed_action_ids: history.slice(),
    last_action_id: lastAction ?? null, action_outcome: pending ? 'unknown' : lastAction ? 'acknowledged' : 'none',
    observation: observation ? { id: observation.observation.id, revision: observation.observation.revision, capture_completed_at: observation.observation.capture_completed_at } : null,
    requires_fresh_observation: true,
  });
  const verifyScope = app => {
    if (app.bundle_id && app.bundle_id !== task.bundle_id) throw new Error('outside_scope');
    if (scopePid !== undefined) {
      if (app.pid !== scopePid) throw new Error('outside_scope');
      return;
    }
    if (app.bundle_id === task.bundle_id) return;
    throw new Error('scope_unavailable');
  };
  const scope = async (initial = false) => {
    // A replay that opens its app takes the scope from the launch, which also finds the app when the device names it without a bundle identifier.
    if (!initial || !task.launch_for_scope) {
      const app = await session.call('get_foreground_app', { device: task.device });
      if (app.bundle_id || scopePid !== undefined) return verifyScope(app);
      throw new Error('scope_unavailable');
    }
    stats.scope_launch_count++;
    const receipt = await session.call('launch_app', { device: task.device, bundle_id: task.bundle_id });
    if (receipt.bundle_id !== task.bundle_id || receipt.launched !== true || receipt.foreground_verified !== true
      || !Number.isSafeInteger(receipt.pid) || receipt.pid <= 0) throw new Error('scope_unavailable');
    scopePid = receipt.pid;
  };
  const fresh = () => {
    const age = Date.now() - Date.parse(observation.observation.structure_started_at ?? observation.observation.capture_started_at);
    if (!Number.isFinite(age) || age < -1000 || age > 25000) throw new Error('stale_observation');
  };
  try {
    signal.throwIfAborted();
    session = new FastSession(call, stats, signal);
    lease = await session.call('acquire_device', { device: task.device, ttl_seconds: 300 });
    if (typeof lease.lease_id !== 'string' || !lease.lease_id) throw new Error('tool_protocol');
    await scope(true);
    for (;;) {
      signal.throwIfAborted();
      await session.call('renew_device', { lease_id: lease.lease_id, ttl_seconds: 300 });
      const current = nextObservation ?? await session.call('observe_device', { device: task.device, source: 'auto', max_elements: 400, include_offscreen: false, include_image: false });
      nextObservation = null;
      if (!current.observation?.id || current.observation.device !== lease.device || observedIds.has(current.observation.id)
        || !Array.isArray(current.elements) || !current.elements.length || current.truncated
        || !['accessibility', 'ocr'].includes(current.source)
        || current.elements.some(e => typeof e.ref !== 'string' || !/^e\d+$/.test(e.ref))
        || new Set(current.elements.map(e => e.ref)).size !== current.elements.length) throw new Error('structure_unavailable');
      observation = current; observedIds.add(current.observation.id); fresh();
      if (current.foreground) verifyScope(current.foreground);
      else await scope();
      if (!history.length) {
        const plans = [task, ...alternatives];
        const selected = plans.findIndex(plan => plan.bundle_id === task.bundle_id && plan.device === task.device && conditionsMatch(plan.steps[0].when, current));
        if (selected >= 0) {
          task = plans[selected]; onSelect(selected);
          const first = task.steps[0].action;
          // A start page keeps the scroll offset it was left with, and routes are recorded from its top.
          const offsetMatters = stats.return_count || ['scroll', 'swipe'].includes(first.op) || first.label !== undefined && !matching(current.elements, first).length;
          const bar = offsetMatters && !scrolledToTop && statusBar(current);
          if (bar) {
            scrolledToTop = true;
            await session.call('tap', { device: task.device, ...bar, verify: false });
            continue;
          }
        } else if (stats.return_count < returnLimit && fingerprint(current) !== previousPage) {
          previousPage = fingerprint(current); stats.return_count++;
          await session.call('go_back', { device: task.device, verify: false });
          continue;
        }
      }
      if (history.length && !conditionsMatch(task.steps[history.length - 1].complete, current)) throw new Error('step_not_completed');
      if (history.length === task.steps.length) {
        if (!succeeded(task, current)) throw new Error('final_condition_failed');
        status = 'success'; break;
      }
      const step = task.steps[history.length];
      if (!conditionsMatch(step.when, current)) throw new Error('step_precondition_failed');
      const candidates = candidatesFor({ ...task, allowed: [step.action] }, current);
      if (candidates.length !== 1) throw new Error('no_candidates');
      const action = candidates[0];
      fresh(); signal.throwIfAborted();
      const args = { ...action.arguments, device: task.device, return_observation: true, post_action_ocr: true, ...(action.op === 'scroll' ? { direction: action.direction } : {}),
        ...(action.ref ? { ref: action.ref } : {}), ...(action.text_id ? { text: task.texts[action.text_id] } : {}),
        ...(unverified.has(action.op) ? { verify: false } : {}) };
      lastAction = action.id; pending = true; stats.action_count++;
      const receipt = await session.call(action.op, args);
      if (receipt.sent !== true) throw new Error('unknown_outcome');
      pending = false; history.push(action.id);
      nextObservation = reusableActionObservation(receipt, task.device, task.bundle_id);
    }
  } catch (error) {
    reason = signal.aborted ? 'cancelled'
      : error?.name === 'TimeoutError' || error?.code === -32001 ? 'request_timeout'
      : reasons.has(error?.message) ? error.message : 'request_failed';
  } finally {
    if (session && releaseLease) {
      const released = await session.close(lease?.lease_id);
      if (!released) { status = 'handoff'; reason = 'cleanup_unconfirmed'; }
    }
    stats.total_ms = performance.now() - started;
    for (const k of ['total_ms', 'tool_ms', 'model_ms', 'scope_ms']) stats[k] = Math.round(stats[k]);
  }
  return { status, handoff_reason: reason, checkpoint: checkpoint(), observation, stats };
}
