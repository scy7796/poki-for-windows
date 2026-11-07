// Runs one tool call and prints the stage timings the daemon reports for it.
//   node test/probes/call-stages.mjs <tool> '<json args>'
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { join } from 'node:path';
import { root } from '../../src/config.mjs';

const [name, raw = '{}'] = process.argv.slice(2);
const client = new Client({ name: 'call-stages', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/stdio.mjs')], env: process.env }));
const started = performance.now();
const result = await client.callTool({ name, arguments: JSON.parse(raw) });
const wall = Math.round(performance.now() - started);
const stages = (result._meta?.timing?.stages ?? []).filter(stage => stage.parent === null);
console.log(`${name}  wall ${wall} ms${result.isError ? '  [ERROR]' : ''}`);
for (const stage of stages) console.log(`  ${stage.phase.padEnd(22)} ${Math.round(stage.elapsed_ms)} ms`);
const text = result.content?.find(block => block.type === 'text')?.text ?? '';
if (result.isError) console.log('error:', text.slice(0, 400));
else if (stages.some(stage => stage.phase === 'ocr')) {
  try { console.log('ocr elements:', JSON.parse(text).elements?.length); } catch { /* not a listing */ }
}
await client.close();
process.exit(0);
