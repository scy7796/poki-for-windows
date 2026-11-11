// Source: poki-app gateway/fast/task.mjs at 9972d34.
// Source: poki-mcp/client/fast/task.mjs. Selector matching is retained; actions use MCP tool arguments.
import { z } from 'zod';
import { flagOn } from '../../src/element-flags.mjs';
const text = z.string().min(1).max(2000);
const id = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).refine(v => !['unknown'].includes(v));
const identity = { identifier: z.string().min(1).optional(), element_id: z.string().min(1).optional() };
const traits = { trait_names: z.array(text).min(1).optional() };
const selector = { label: z.string().max(2000), role: z.string().min(1).max(100).optional(), ...traits, ...identity,
  label_prefix: z.string().min(1).max(2000).optional(), label_suffix: z.string().max(2000).optional() };
const condition = z.strictObject({ ...selector, value: z.string().max(2000).optional(), checked: z.boolean().optional() });
const when = z.array(condition).min(1).max(10).optional();
const action = z.object({
  id, op: text, when, label: z.string().optional(), role: z.string().optional(), ...traits, ...identity,
  text_id: id.optional(), direction: z.string().optional(), arguments: z.record(z.string(), z.unknown()).default({}),
});
const commonFields = {
  device: text, bundle_id: z.string().regex(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/), goal: text,
  launch_for_scope: z.boolean().default(false),
  texts: z.record(id, z.string().max(2000)).default({}),
  success: z.array(condition).min(1).max(20),
};
function validateTask(task, ctx) {
  const actions = task.allowed ?? task.steps.map(step => step.action);
  const conditions = [...task.success, ...actions.flatMap(a => a.when ?? []), ...(task.steps ?? []).flatMap(step => [...step.when, ...step.complete])];
  if ([...actions, ...conditions].some(s => s.op !== 'scroll' && s.label === '' && !s.role)) ctx.addIssue({ code: 'custom', message: 'Empty label requires explicit role' });
  if (new Set(actions.map(a => a.id)).size !== actions.length
      || actions.some(a => a.text_id && !Object.hasOwn(task.texts, a.text_id))) ctx.addIssue({ code: 'custom', message: 'Invalid action IDs or literals' });
}
export const taskSchema = z.strictObject({ ...commonFields, allowed: z.array(action).min(1).max(50) }).superRefine(validateTask);
export const planSchema = z.strictObject({ ...commonFields, steps: z.array(z.strictObject({
  when: z.array(condition).min(1).max(10), action, complete: z.array(condition).min(1).max(20),
})).min(1).max(50) }).superRefine(validateTask);
export function matching(elements, selector) {
  return elements.filter(e => flagOn(e.visible) && flagOn(e.enabled)
    && (selector.label_prefix !== undefined
      ? (e.label ?? e.text ?? '').startsWith(selector.label_prefix) && (e.label ?? e.text ?? '').endsWith(selector.label_suffix ?? '')
      : (e.label ?? e.text ?? '') === selector.label || e.text === selector.label)
    && (!selector.role || (e.role ?? e.type) === selector.role)
    && (!selector.trait_names || selector.trait_names.every(trait => e.trait_names?.includes(trait)))
    && (selector.identifier === undefined || e.identifier === selector.identifier)
    && (selector.element_id === undefined || e.id === selector.element_id));
}
export function selectorFor(element) {
  return { label: element.label ?? element.text ?? '', role: element.role ?? element.type,
    ...(element.trait_names?.includes('Header') ? { trait_names: ['Header'] } : {}) };
}
export function succeeded(task, observation) {
  return conditionsMatch(task.success, observation);
}
export function conditionsMatch(conditions, observation) {
  return conditions.every(condition => {
    const matches = matching(observation.elements, condition);
    return matches.length === 1 && (condition.value === undefined || matches[0].value === condition.value)
      && (condition.checked === undefined || matches[0].checked === condition.checked);
  });
}
export function candidatesFor(task, observation) {
  const candidates = [];
  for (const action of task.allowed) {
    if (action.when && !conditionsMatch(action.when, observation)) continue;
    if (action.label === undefined) { candidates.push(action); continue; }
    const matches = matching(observation.elements, action);
    if (matches.length > 1) throw new Error('ambiguous_target');
    if (!matches.length) continue;
    const element = matches[0], role = element.role ?? element.type;
    candidates.push({ ...action, ref: element.ref, role });
  }
  return candidates;
}
