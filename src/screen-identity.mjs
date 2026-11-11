import { createHash } from 'node:crypto';
import { flagOn } from './element-flags.mjs';

export function screenIdentity(screen) {
  if (screen.prompt || screen.unavailable) return null;
  if (screen.page_identity) return screen.page_identity;
  const elements = screen.elements ?? screen.text.map(text => {
    const split = /^([^:]+): (.*)$/.exec(text);
    return split ? { role: split[1], label: split[2].split(' = ')[0] } : { role: 'StaticText', label: text };
  });
  if (elements.some(element => /^(Alert|Dialog|Sheet)$/i.test(element.role ?? element.type ?? ''))) return null;
  const entries = elements.filter(element => flagOn(element.visible))
    .flatMap(element => {
      const role = element.type ?? element.role ?? 'Element';
      if (/^(Key|Keyboard|StatusBar)$/i.test(role)) return [];
      const input = /^(?:AX|XCUIElementType)?(?:Secure)?(?:TextField|TextArea|TextView|SearchField)$/i.test(role);
      const label = element.label || element.text || element.placeholder || (!input && element.value);
      if (typeof label !== 'string' || !label.trim()) return [];
      return [[role, label.trim().replace(/ \(focused\)$/, '')]];
    });
  if (!entries.length) return null;
  const app = entries.find(([role]) => role === 'Application')?.[1];
  const foreground = app ?? (typeof screen.foreground === 'string' ? screen.foreground : screen.foreground?.name ?? screen.foreground?.bundle_id) ?? 'unknown';
  const id = createHash('sha256').update(JSON.stringify([foreground, [...new Set(entries.map(entry => JSON.stringify(entry)))].sort()])).digest('hex').slice(0, 16);
  return { id, title: `${foreground} [${id}]` };
}
