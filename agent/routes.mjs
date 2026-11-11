// Source: poki-app gateway/routes.mjs at 9972d34.
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { matching, conditionsMatch, planSchema, selectorFor } from './fast/task.mjs';
import { flagOn } from '../src/element-flags.mjs';
import { learnReadout, readCurrent } from './readout.mjs';

const observationTools = new Set(['observe_device', 'list_elements', 'post_action_observation']);
const passiveTools = new Set(['poki_mcp_status', 'list_apps', 'get_foreground_app', 'take_screenshot', 'acquire_device', 'renew_device', 'release_device']);
const label = e => e.label ?? e.text ?? '';
const role = e => e.role ?? e.type;
const selector = selectorFor;
const quote = /“([^”]+)”|「([^」]+)」|"([^"\n]+)"/g;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function goal(prompt, texts) {
  const parts = []; let position = 0;
  const spans = [];
  for (const match of prompt.matchAll(quote)) {
    const value = match.slice(1).find(Boolean);
    const id = Object.keys(texts).find(id => texts[id] === value);
    if (id) spans.push({ start: match.index + 1, end: match.index + 1 + value.length, id });
  }
  for (const [id, value] of Object.entries(texts)) {
    if (!value || spans.some(span => span.id === id)) continue;
    const start = prompt.indexOf(value), end = start + value.length;
    if (start >= 0 && start === prompt.lastIndexOf(value) && !spans.some(span => start < span.end && end > span.start)) spans.push({ start, end, id });
  }
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    parts.push(prompt.slice(position, span.start), { text_id: span.id });
    position = span.end;
  }
  parts.push(prompt.slice(position));
  return parts;
}
function bind(parts, prompt, literals) {
  const ids = parts.filter(part => typeof part !== 'string').map(part => part.text_id);
  const pattern = parts.map((part, index) => {
    if (typeof part === 'string') return escape(part).replace(/\s+/g, '\\s+').replace(/[“”「」"]/g, '[“”「」"]');
    const quoted = /[“「"]$/.test(parts[index - 1]) && /^[”」"]/.test(parts[index + 1]);
    return quoted ? '([^“”「」"]+?)' : `(${escape(literals[part.text_id])})`;
  }).join('');
  const match = prompt.trim().match(new RegExp(`^${pattern}$`));
  if (!match) return null;
  const texts = {};
  for (let i = 0; i < ids.length; i++) {
    if (Object.hasOwn(texts, ids[i]) && texts[ids[i]] !== match[i + 1]) return null;
    texts[ids[i]] = match[i + 1];
  }
  return texts;
}
function substitute(value, texts) {
  if (typeof value === 'string') return value.replace(/\{\{(text_\d+)\}\}/g, (whole, id) => texts[id] ?? whole);
  if (Array.isArray(value)) return value.map(item => substitute(item, texts));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, texts)]));
  return value;
}
function template(value, texts) {
  return typeof value === 'string' ? goal(value, texts).map(part => typeof part === 'string' ? part : `{{${part.text_id}}}`).join('') : value;
}
const elementKey = e => JSON.stringify([role(e), e.identifier ? ['identifier', e.identifier] : e.id ? ['id', e.id] : ['label', label(e)]]);
function inputTemplate(before, after, text, id) {
  if (typeof after !== 'string' || before === after || !text) return null;
  const candidates = [];
  for (let at = after.indexOf(text); at >= 0; at = after.indexOf(text, at + 1)) {
    const prefix = after.slice(0, at), suffix = after.slice(at + text.length);
    if (before.length >= prefix.length + suffix.length && before.startsWith(prefix) && before.endsWith(suffix)) candidates.push(`${prefix}{{${id}}}${suffix}`);
  }
  return candidates.length === 1 ? candidates[0] : null;
}
function fillConditions(when, action, before, after, text) {
  if (action.op !== 'fill' || !action.text_id || !/^(TextField|TextView|TextArea|SearchField)$/.test(action.role ?? '')) return when;
  const targets = matching(before.elements, action), written = matching(after.elements, action);
  if (targets.length !== 1 || written.length !== 1 || elementKey(targets[0]) !== elementKey(written[0]) || written[0].value !== text) return when;
  const target = targets[0], oldText = target.value === target.placeholder ? '' : target.value;
  if (typeof oldText !== 'string') return when;
  return when.flatMap(condition => {
    const element = matching(before.elements, condition)[0];
    if (element === target) {
      const { value, ...locator } = condition;
      return [{ ...locator, ...(action.identifier ? { identifier: action.identifier } : { element_id: action.element_id }) }];
    }
    if (!element || role(element) !== 'StaticText') return [condition];
    const changed = after.elements.filter(e => elementKey(e) === elementKey(element));
    if (changed.length !== 1) return [condition];
    const replacement = inputTemplate(label(element), label(changed[0]), text, action.text_id);
    return replacement && substitute(replacement, { [action.text_id]: oldText }) === label(element) ? [] : [condition];
  });
}
function parameterizedPlan(compiled, texts) {
  const bindings = new Map();
  const parameterize = (condition, observation) => {
    const element = observation && matching(observation.elements, condition)[0];
    const fields = element && bindings.get(elementKey(element));
    const result = { ...condition };
    for (const [field, binding] of Object.entries(fields ?? {})) {
      if (result[field] === binding.value) result[field] = binding.template;
    }
    return result;
  };
  const steps = compiled.steps.map(({ before, after, when, action, complete }) => {
    const start = fillConditions(when, action, before, after, texts[action.text_id]);
    const next = { when: start.map(c => parameterize(c, before)), action: parameterize(action, before) };
    if (action.text_id) {
      for (const element of after.elements) {
        const key = elementKey(element), previous = before.elements.filter(e => elementKey(e) === key);
        if (previous.length !== 1) continue;
        const fields = { ...bindings.get(key) };
        for (const field of ['label', 'value']) {
          const value = field === 'label' ? label(element) : element.value;
          const prior = field === 'label' ? label(previous[0]) : previous[0].value ?? '';
          const replacement = inputTemplate(prior, value, texts[action.text_id], action.text_id);
          if (replacement) fields[field] = { value, template: replacement };
        }
        bindings.set(key, fields);
      }
    }
    return { ...next, complete: complete.map(c => parameterize(c, after)) };
  });
  return { steps, success: compiled.success.map(c => parameterize(c, compiled.final)) };
}
function conditions(observation, preferStates = true) {
  const candidates = observation.elements.flatMap(e => {
    if (!/Heading|StaticText|TextField|TextView|TextArea|SearchField|Button|Link|GenericElement|Group|CheckBox/.test(role(e) ?? '') && typeof e.checked !== 'boolean') return [];
    if (!label(e) && !/TextField|TextView|TextArea|SearchField/.test(role(e) ?? '')) return [];
    const s = selector(e);
    if ((!s.label && !s.role) || matching(observation.elements, s).length !== 1) return [];
    return [{ ...s, ...(typeof e.value === 'string' ? { value: e.value } : {}), ...(typeof e.checked === 'boolean' ? { checked: e.checked } : {}) }];
  });
  const states = candidates.filter(condition => /Heading|StaticText|TextField|TextView|TextArea|SearchField/.test(condition.role ?? '') || typeof condition.checked === 'boolean');
  return (preferStates && states.length ? states : candidates).slice(0, 20);
}
// Counts, times, percentages and capacities change between runs, so step conditions avoid them when the page has other text.
function stable(list) {
  const kept = list.filter(condition => !/\d/.test(`${condition.label}${condition.value ?? ''}`));
  return kept.length ? kept : list;
}
// A scroll changes which rows are on screen, not the headings, so it is confirmed by a few rows it brought into view.
function revealed(before, after) {
  const shown = stable(conditions(after, false)).filter(condition => !matching(before.elements, { label: condition.label, role: condition.role }).length);
  const middle = Math.max(0, Math.floor(shown.length / 2) - 1);
  return shown.slice(middle, middle + 3);
}
function resultMatches(observation, details) {
  const candidates = conditions(observation, false);
  const selected = [];
  for (const detail of details) {
    if (typeof detail.value !== 'string' || !detail.value) return null;
    const field = typeof detail.label === 'string' ? detail.label.replace(/\s+/g, '') : '';
    const matches = candidates.filter(condition => condition.label === detail.value || condition.value === detail.value
      || field && condition.label.replace(/\s+/g, '').includes(field) && condition.label.includes(detail.value));
    if (matches.length !== 1) return null;
    selected.push(matches[0]);
  }
  return details.length ? selected : null;
}
function resultConditions(observation, details) {
  const matches = resultMatches(observation, details);
  if (!matches) return null;
  const headings = conditions(observation, false).filter(condition => condition.role === 'Heading' || condition.trait_names?.includes('Header'));
  const selected = [...headings, ...matches];
  const unique = [...new Map(selected.map(condition => [JSON.stringify(condition), condition])).values()];
  return details.length && unique.length <= 20 ? unique : null;
}
function navigationConditions({ action, before, after }) {
  if (!before || !after || action.op !== 'tap' || action.role !== 'Button' || !action.label) return null;
  const isHeading = e => role(e) === 'Heading' || e.trait_names?.includes('Header');
  const headings = after.elements.filter(e => label(e) === action.label && isHeading(e));
  if (headings.length !== 1) return null;
  const heading = selector(headings[0]);
  if (matching(before.elements, heading).length || matching(after.elements, heading).length !== 1) return null;
  const previousHeadings = before.elements.filter(isHeading).map(label);
  const back = after.elements.filter(e => role(e) === 'Button' && label(e) &&
    (e.identifier === 'BackButton' || previousHeadings.includes(label(e))));
  if (back.length !== 1) return null;
  const previousPage = selector(back[0]);
  if (matching(before.elements, previousPage).length || matching(after.elements, previousPage).length !== 1) return null;
  return [heading, previousPage];
}
function actionFor(entry, before, id) {
  const { device, ref, field, x, y, ...args } = entry.args;
  let target;
  if (ref) target = before.elements.find(e => e.ref === ref);
  else if (field || entry.tool === 'tap_text') {
    const text = field ?? args.text;
    const matches = before.elements.filter(e => [label(e), e.value, e.placeholder, e.identifier].includes(text));
    if (matches.length === 1) target = matches[0];
  } else if (Number.isFinite(x) && Number.isFinite(y)) {
    const matches = before.elements.filter(e => {
      const f = e.frame ?? e;
      return flagOn(e.visible) && x >= f.x && y >= f.y && x <= f.x + f.width && y <= f.y + f.height;
    }).sort((a, b) => (a.frame ?? a).width * (a.frame ?? a).height - (b.frame ?? b).width * (b.frame ?? b).height);
    target = matches[0];
  }
  if ((ref || field || x !== undefined || entry.tool === 'tap_text') && !target) return null;
  if (target && matching(before.elements, selector(target)).length !== 1) return null;
  const identity = target?.identifier ? { identifier: target.identifier } : target?.id ? { element_id: target.id } : null;
  if (entry.tool === 'fill' && !identity) return null;
  if (entry.tool === 'tap_text') delete args.text;
  return { id, op: entry.tool === 'tap_text' ? 'tap' : entry.tool, ...(target ? selector(target) : {}),
    ...(entry.tool === 'fill' ? identity : {}),
    ...(args.direction ? { direction: args.direction } : {}), arguments: args };
}
// A page as an action's own readback describes it: text lines, without frames or references. It stands in
// for an observation only when none followed the action, and a list cut short stands in for nothing.
function readback(result) {
  const screen = result?.screen;
  if (screen?.source !== 'accessibility' || screen.more || !Array.isArray(screen.text) || !screen.text.length) return null;
  const elements = [];
  for (const line of screen.text) {
    const match = /^(\w+): (.*?)(?: \(focused\))?$/su.exec(line);
    if (!match) return null;
    const parts = match[2].split(' = ');
    const empty = /^\(empty, placeholder (".*")\)$/su.exec(parts.at(-1));
    let placeholder;
    if (empty) {
      try { placeholder = JSON.parse(empty[1]); } catch { return null; }
      parts.pop();
    }
    if (parts.length > 2) return null;
    elements.push({ role: match[1], label: parts[0] ?? '', ...(parts.length === 2 ? { value: parts[1] } : {}), ...(placeholder === undefined ? {} : { placeholder }) });
  }
  return { elements, readback: true };
}
// Whether two screens show the same page: the same rows with the same values. A label with digits, such as a
// time or free space, may change by itself and is left out, and so is a number in a value; a switch's 0 or 1 is kept.
function pageRows(observation) {
  return new Set(observation.elements.filter(e => flagOn(e.visible) && !/\d/.test(label(e))).flatMap(e => {
    const value = typeof e.value === 'string' && e.value !== e.placeholder && e.value !== label(e) ? e.value : '';
    const parts = [label(e), /\d/.test(value) && !/^[01]$/.test(value) ? '#' : value].filter(Boolean);
    return parts.length ? [`${role(e)}: ${parts.join(' = ')}`] : [];
  }));
}
function samePage(one, two) {
  const first = pageRows(one), second = pageRows(two);
  return first.size === second.size && [...first].every(row => second.has(row));
}
function compile(trace) {
  // current: the screen the next action starts from. pending: the last action, until a screen shows where it
  // led. doubt: after a failed step, the screen it was sent to, or null when the route has no screen yet.
  let current = null, pending = null, doubt;
  const steps = [];
  const close = after => {
    const { before, readback: _readback, ...step } = pending;
    pending = null;
    const complete = before && ['scroll', 'swipe'].includes(step.action.op) ? revealed(before, after) : stable(conditions(after));
    if (!complete.length) return false;
    if (!before || !conditionsMatch(step.when, after) || !conditionsMatch(complete, before)) steps.push({ ...step, complete, before, after });
    current = after;
    return true;
  };
  const see = (screen, observed) => {
    if (doubt !== undefined) {
      // A failed step is left out only when the screen after it is the one it was sent to.
      if (doubt && !samePage(doubt, screen)) return false;
      current = !observed && doubt ? doubt : screen;
      doubt = undefined;
      return true;
    }
    if (pending) {
      if (observed) return close(screen);
      pending.readback = screen;
      return true;
    }
    if (observed || !current || !samePage(current, screen)) current = screen;
    return true;
  };
  for (const entry of trace) {
    if (passiveTools.has(entry.tool)) continue;
    if (entry.tool === 'launch_app') { if (steps.length || pending) return null; current = null; doubt = undefined; continue; }
    if (observationTools.has(entry.tool)) {
      if (!entry.error && entry.result?.elements?.length && !see(entry.result, true)) return null;
      continue;
    }
    // A batch that stopped is traced after its steps, with the screen it ended on.
    if (entry.tool === 'batch_commands') {
      const screen = readback(entry.result);
      if (screen && !see(screen, false)) return null;
      continue;
    }
    if (entry.error) {
      if (pending && (!pending.readback || !close(pending.readback))) return null;
      if (doubt === undefined) {
        if (!current && steps.length) return null;
        doubt = current;
      }
      current = null;
      continue;
    }
    if (entry.tool === 'hide_keyboard' && entry.result?.hidden === true && entry.result?.already_hidden === true) continue;
    if (pending && !pending.readback) {
      // Taps sent together, with no screen read between them: the row the next tap names is what confirms
      // the step before it. Any other action needs the screen it starts from.
      const { device, text, ...args } = entry.args;
      if (entry.tool !== 'tap_text' || typeof text !== 'string' || !text || pending.action.arguments.text !== undefined) return null;
      const { before, readback: _readback, ...step } = pending, named = [{ label: text }];
      steps.push({ ...step, complete: named, before, after: null });
      pending = { before: null, when: named, action: { id: `step_${steps.length + 1}`, op: 'tap', label: text, arguments: args } };
      continue;
    }
    if (pending && !close(pending.readback)) return null;
    if (!current) return null;
    const action = actionFor(entry, current, `step_${steps.length + 1}`);
    const when = stable(conditions(current)).slice(0, 10);
    if (!action || !when.length) return null;
    pending = { before: current, when, action };
    const screen = readback(entry.result);
    if (screen) pending.readback = screen;
    current = null;
  }
  if (pending || !steps.length || !current || current.readback) return null;
  const success = conditions(current);
  if (!success.length || !conditionsMatch(success, current)) return null;
  return { steps, success, final: current };
}

const warnedRouteFiles = new Set();
function ignoreInvalidRoute(path, reason = 'invalid') {
  if (warnedRouteFiles.has(path)) return;
  warnedRouteFiles.add(path);
  console.error(reason === 'incompatible'
    ? 'Poki Agent: a cached learned route could not be reused for this task; the cache file was preserved.'
    : 'Poki Agent: an invalid learned-route cache entry was skipped; the cache file was preserved.');
}

function validStoredRoute(route) {
  return route && typeof route === 'object' && typeof route.bundle_id === 'string'
    && Array.isArray(route.goal) && route.texts && typeof route.texts === 'object' && !Array.isArray(route.texts)
    && route.goal.every(part => typeof part === 'string' || (part && typeof part.text_id === 'string'
      && typeof route.texts[part.text_id] === 'string'))
    && route.plan && Array.isArray(route.plan.steps) && Array.isArray(route.plan.success)
    && route.plan.steps.every(step => step && step.action && typeof step.action.op === 'string')
    && typeof route.updatedAt === 'string' && route.readout && typeof route.readout === 'object';
}

export class RouteStore {
  constructor(directory) { this.directory = directory; }
  async find(prompt, context = '') {
    let names;
    try { names = await readdir(this.directory); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const routes = [];
    for (const name of names.filter(name => name.endsWith('.json'))) {
      const path = join(this.directory, name);
      // Only malformed cache data is recoverable; do not hide filesystem failures.
      const content = await readFile(path, 'utf8');
      let route;
      try { route = JSON.parse(content); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        ignoreInvalidRoute(path);
        continue;
      }
      if (!route || typeof route !== 'object') { ignoreInvalidRoute(path); continue; }
      if (route.version !== 5 || !route.bundle_id) continue;
      if ((route.context ?? '') !== context) continue;
      if (!validStoredRoute(route)) { ignoreInvalidRoute(path); continue; }
      const bindings = bind(route.goal, prompt, route.texts);
      if (!bindings) continue;
      const plan = substitute(route.plan, bindings);
      const texts = { ...route.texts, ...bindings };
      if (!planSchema.safeParse({ device: 'cached-route', bundle_id: route.bundle_id, goal: prompt, texts, ...plan }).success) {
        // The bound task can exceed schema limits even when the stored route is healthy.
        ignoreInvalidRoute(path, 'incompatible');
        continue;
      }
      if (plan.steps.some(({ action }) => action.op === 'fill' && !action.identifier && !action.element_id)) continue;
      routes.push({ ...route, readout: substitute(route.readout, bindings), plan: { ...plan, texts } });
    }
    const [route, ...alternatives] = routes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return route ? { ...route, alternatives: alternatives.filter(candidate => candidate.bundle_id === route.bundle_id) } : null;
  }
  async learn({ id, prompt, context = '', bundleId, device, trace, details = [], answer, planTitle, opening, verify }) {
    if (!bundleId) return null;
    const compiled = compile(trace);
    if (!compiled) return null;
    if (!verify || !await verify()) return null;
    const readout = learnReadout(answer, compiled.final);
    if (!readout) return null;
    const texts = {};
    for (const step of compiled.steps) {
      const text = step.action.arguments.text;
      if (typeof text !== 'string') continue;
      let textId = Object.keys(texts).find(id => texts[id] === text);
      if (!textId) { textId = `text_${Object.keys(texts).length + 1}`; texts[textId] = text; }
      step.action.text_id = textId;
      delete step.action.arguments.text;
    }
    const parts = goal(prompt, texts);
    if (!Object.keys(texts).length) {
      const headings = conditions(compiled.final, false).filter(condition => condition.role === 'Heading' || condition.trait_names?.includes('Header'));
      compiled.success = readout.kind === 'action' ? resultConditions(compiled.final, details)
        : readout.kind === 'field' ? [...headings, ...readout.fields.map(field => field.selector)]
          : headings.length ? headings : readout.start ? [readout.start] : null;
      if (!compiled.success) return null;
      for (let index = 0; index < compiled.steps.length; index++) {
        const step = compiled.steps[index], navigation = navigationConditions(step);
        if (!navigation) continue;
        step.complete = navigation;
        const next = compiled.steps[index + 1];
        if (next?.before && conditionsMatch(navigation, next.before)) next.when = navigation;
      }
    }
    const plan = parameterizedPlan(compiled, texts);
    if (!Object.keys(texts).length) plan.steps.at(-1).complete = plan.success;
    const key = createHash('sha256').update(JSON.stringify([bundleId, parts, context, plan.steps[0].when])).digest('hex');
    planSchema.parse({ device, bundle_id: bundleId, goal: prompt, texts, ...substitute(plan, texts) });
    const route = { version: 5, id: key, bundle_id: bundleId, goal: parts, context, texts, plan, readout,
      planTitle: template(planTitle, texts), opening: template(opening, texts), sourceTask: id, updatedAt: new Date().toISOString() };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, `${key}.json`), temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(route, null, 2), { mode: 0o600 });
    await rename(temporary, path);
    return { id: key, path };
  }
  render(value, texts) { return substitute(value, texts); }
  readResult(route, observation) {
    return conditionsMatch(route.plan.success, observation) ? readCurrent(route.readout, observation) : null;
  }
}
