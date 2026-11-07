import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { join } from 'node:path';
import { root } from '../../src/config.mjs';

const client = new Client({ name: 'perf-read', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/stdio.mjs')], env: { ...process.env, POKI_MCP_APPROVAL_MODE: 'allow' } }));

const time = async (label, name, args) => {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args });
  const wall = Math.round(performance.now() - started);
  const stages = (result._meta?.timing?.stages ?? []).filter(s => s.parent === null);
  const detail = stages.map(s => `${s.phase} ${Math.round(s.elapsed_ms)}`).join(', ');
  const text = result.content?.find(c => c.type === 'text')?.text ?? '';
  const summary = result.isError ? 'ERROR ' + text.slice(0, 80) : (() => { try { const v = JSON.parse(text); return `source=${v.source} elements=${v.elements?.length}`; } catch { return ''; } })();
  console.log(`${label.padEnd(26)} ${String(wall).padStart(6)} ms  [${detail}]  ${summary}`);
};

for (const round of [1, 2]) {
  await time(`take_screenshot #${round}`, 'take_screenshot', { max_width: 900 });
  await time(`list_elements ocr #${round}`, 'list_elements', { source: 'ocr' });
  await time(`list_elements ax  #${round}`, 'list_elements', {});
}
await client.close();
process.exit(0);
