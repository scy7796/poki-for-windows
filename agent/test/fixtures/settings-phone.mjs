import { readFile } from 'node:fs/promises';

export const recorded = JSON.parse(await readFile(new URL('./settings-routes.json', import.meta.url), 'utf8'));

// The Settings pages the recorded demonstration passed through, in order, and where each input leads.
// A scroll or a tap on the status bar changes the offset of the current page; a tap opens a page on top.
const names = ['top', 'scrolled', 'general', 'about', 'aboutMore', 'aboutEnd', 'certificates'];
export const pages = Object.fromEntries(recorded.demonstration.trace.filter(entry => entry.result?.elements)
  .map((entry, index) => [names[index], entry.result.elements]));
const scrolls = { top: 'scrolled', about: 'aboutMore', aboutMore: 'aboutEnd' };
const tops = { scrolled: 'top', aboutMore: 'about', aboutEnd: 'about' };
const opens = { scrolled: { 通用: 'general' }, general: { 关于本机: 'about' }, aboutEnd: { 证书信任设置: 'certificates' } };
const statusBarHeight = 54;
// The test iPhone reports Settings by name and process, without a bundle identifier.
const app = { bundle_id: null, name: '设置', pid: 11695 };

export function settingsPhone({ open = ['top'], edit = (_page, elements) => elements } = {}) {
  const stack = [...open], calls = [];
  let observations = 0;
  const shown = () => edit(stack.at(-1), pages[stack.at(-1)]);
  const reply = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const touch = (x, y) => shown().filter(e => e.frame && e.role !== 'Application'
    && x >= e.frame.x && y >= e.frame.y && x <= e.frame.x + e.frame.width && y <= e.frame.y + e.frame.height)[0];
  const press = element => {
    const next = opens[stack.at(-1)]?.[element?.label];
    if (next) stack.push(next);
    return reply({ sent: true });
  };
  const call = async (name, args = {}) => {
    calls.push({ name, args });
    if (['acquire_device', 'renew_device', 'release_device'].includes(name)) return reply({ lease_id: 'fixture-lease', device: 'fixture-device', released: true });
    if (name === 'get_foreground_app') return reply(app);
    if (name === 'launch_app') return reply({ ...app, bundle_id: 'com.apple.Preferences', launched: true, foreground_verified: true });
    if (name === 'observe_device' || name === 'list_elements') {
      const now = new Date().toISOString();
      observations++;
      return reply({ source: 'accessibility', truncated: false, width: 402, height: 874, foreground: app, elements: shown(),
        observation: { id: `observation-${observations}`, revision: observations, device: 'fixture-device', capture_started_at: now, capture_completed_at: now } });
    }
    if (name === 'scroll') { stack[stack.length - 1] = scrolls[stack.at(-1)] ?? stack.at(-1); return reply({ sent: true }); }
    if (name === 'go_back') { if (stack.length > 1) stack.pop(); return reply({ sent: true }); }
    if (name === 'tap' && args.ref) return press(shown().find(e => e.ref === args.ref));
    if (name === 'tap' && args.y < statusBarHeight) { stack[stack.length - 1] = tops[stack.at(-1)] ?? stack.at(-1); return reply({ sent: true }); }
    if (name === 'tap') return press(touch(args.x, args.y));
    throw new Error(`Unexpected fixture device call: ${name}`);
  };
  return { call, calls, stack };
}
