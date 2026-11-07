import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { join } from 'node:path';
import { root } from '../../src/config.mjs';
const client = new Client({ name: 'probe', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/stdio.mjs')], env: process.env }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content?.find(b => b.type === 'text')?.text ?? '';
  try { return JSON.parse(t); } catch { return { text: t }; }
};
await call('launch_app', { bundle_id: 'com.apple.Preferences', terminate_existing: true });
for (let i = 0; i < 8; i++) {
  await new Promise(r => setTimeout(r, 700));
  const v = await call('list_elements', {});
  const list = v.elements ?? [];
  const field = list.find(e => e.role === 'SearchField');
  const rows = list.filter(e => e.role === 'Button').slice(0, 3).map(e => e.label).join('|');
  console.log(`${i}: n=${list.length} fieldY=${field ? Math.round(field.frame.y) : '-'} 标签=${list.some(e => ['建议','最近使用'].includes(e.label))} rows=${rows}`);
}
await client.close(); process.exit(0);
