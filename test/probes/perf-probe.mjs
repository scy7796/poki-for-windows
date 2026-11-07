// Measures where a tool call spends its time, using the stages the daemon reports.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { join } from 'node:path';
import { root } from '../../src/config.mjs';

const client = new Client({ name: 'perf-probe', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/stdio.mjs')], env: { ...process.env, POKI_MCP_APPROVAL_MODE: 'allow' } }));

const show = (label, result, wall) => {
  const stages = result._meta?.timing?.stages ?? [];
  const total = stages.filter(stage => stage.parent === null).reduce((sum, stage) => sum + stage.elapsed_ms, 0);
  console.log(`\n${label}: wall ${Math.round(wall)} ms, stages ${Math.round(total)} ms${result.isError ? ' [ERROR]' : ''}`);
  for (const stage of stages) {
    const depth = stage.parent === null ? '' : '  └ ';
    console.log(`   ${depth}${stage.phase.padEnd(22)} ${String(Math.round(stage.elapsed_ms)).padStart(6)} ms`);
  }
  if (result.isError) console.log('   error:', result.content?.[0]?.text?.slice(0, 200));
};

const time = async (label, name, args) => {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args });
  show(label, result, performance.now() - started);
};

await time('poki_mcp_status', 'poki_mcp_status', {});
await time('take_screenshot', 'take_screenshot', { max_width: 900 });
await time('list_elements (accessibility)', 'list_elements', {});
await time('list_elements (ocr)', 'list_elements', { source: 'ocr' });
await time('tap', 'tap', { x: 220, y: 120 });
await time('list_elements (accessibility, warm)', 'list_elements', {});
await client.close();
process.exit(0);
