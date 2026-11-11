import { matching, selectorFor } from './fast/task.mjs';
import { flagOn } from '../src/element-flags.mjs';

const time = /\b\d{1,2}:\d{2}\b/u;
const text = (element, field) => typeof element?.[field] === 'string' ? element[field] : '';
const visible = element => flagOn(element.visible) && flagOn(element.enabled);
const unique = (elements, selector) => {
  const found = matching(elements, selector);
  return found.length === 1 ? found[0] : null;
};
const byRef = (elements, ref) => {
  const found = elements.filter(element => element.ref === ref && visible(element));
  return found.length === 1 ? found[0] : null;
};

export function learnReadout(answer, observation) {
  if (!answer || !observation?.elements?.length || observation.truncated) return null;
  if (answer.kind === 'action') return { kind: 'action' };
  const { elements } = observation;
  const fallback = answer.kind === 'list' ? { kind: 'list' } : null;
  if (!Array.isArray(answer.items) || !answer.items.length) return fallback;
  const items = answer.items.map(item => ({ ...item, element: byRef(elements, item.ref) }));
  if (items.some(item => !item.element || !['label', 'value'].includes(item.field) || !text(item.element, item.field).trim())) return fallback;
  if (new Set(items.map(item => item.ref)).size !== items.length) return fallback;
  if (answer.kind === 'field') {
    const fields = [];
    for (const item of items) {
      let selector, title;
      if (item.field === 'value' && item.element.label) {
        selector = selectorFor(item.element); title = item.element.label;
      } else if (item.field === 'label' && typeof item.prefix === 'string' && item.prefix &&
          item.element.label.startsWith(item.prefix) && item.element.label.endsWith(item.suffix ?? '') && item.element.label.length > item.prefix.length + (item.suffix?.length ?? 0)) {
        selector = { label: '', role: item.element.role ?? item.element.type, label_prefix: item.prefix, label_suffix: item.suffix ?? '' };
        title = item.prefix.replace(/[\s:：、，,]+$/u, '');
      } else return null;
      if (!title || !unique(elements, selector)) return null;
      fields.push({ selector, field: item.field, prefix: item.field === 'label' ? item.prefix : '', title });
    }
    return { kind: 'field', fields };
  }
  if (answer.kind !== 'list') return null;
  const start = byRef(elements, answer.start_ref), end = byRef(elements, answer.end_ref);
  if (!start || !end) return fallback;
  const startSelector = selectorFor(start), endSelector = selectorFor(end);
  if (!unique(elements, startSelector) || !unique(elements, endSelector)) return fallback;
  const from = elements.indexOf(start), to = elements.indexOf(end), role = items[0].element.role ?? items[0].element.type, field = items[0].field;
  if (from >= to || items.some(item => item.field !== field || (item.element.role ?? item.element.type) !== role)) return fallback;
  const rows = elements.slice(from + 1, to).filter(element => visible(element) && (element.role ?? element.type) === role);
  if (rows.length !== items.length || rows.some((row, index) => row !== items[index].element)) return fallback;
  return { kind: 'list', start: startSelector, end: endSelector, row: { role, field, requiresTime: rows.every(row => time.test(text(row, field))) } };
}

export function readCurrent(readout, observation) {
  if (!readout || !observation?.elements?.length || observation.truncated) return null;
  if (readout.kind === 'action') return { success: true, summary: 'Task completed; the current result is verified.', details: [] };
  const { elements } = observation;
  let details;
  if (readout.kind === 'field') {
    details = readout.fields.map(field => {
      const element = unique(elements, field.selector), raw = text(element, field.field);
      return { label: field.title, value: raw.slice(field.prefix.length) };
    });
  } else if (readout.kind === 'list') {
    if (!readout.start || !readout.end || !readout.row) return null;
    const start = unique(elements, readout.start), end = unique(elements, readout.end);
    if (!start || !end || elements.indexOf(start) >= elements.indexOf(end)) return null;
    const rows = elements.slice(elements.indexOf(start) + 1, elements.indexOf(end)).filter(element => visible(element) && (element.role ?? element.type) === readout.row.role);
    if (!rows.length || rows.some(row => !text(row, readout.row.field).trim() || readout.row.requiresTime && !time.test(text(row, readout.row.field)))) return null;
    details = rows.map(row => ({ label: start.label, value: text(row, readout.row.field) }));
    if (new Set(details.map(detail => detail.value)).size !== details.length) return null;
  } else return null;
  if (!details.length || details.some(detail => !detail.value.trim())) return null;
  return { success: true, summary: details.map(detail => readout.kind === 'field' ? `${detail.label}: ${detail.value}` : detail.value).join('\n'), details };
}
