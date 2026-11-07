// Stage 0 baseline: how long each kind of call takes, from the daemon's own stage timings.
//
// Reads are safe to run at any time. Input is not: a tap moves whatever is on the phone, so
// it is only measured when asked for, and only against the Settings app.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { join } from 'node:path';
import { root } from '../../src/config.mjs';

const runs = Number(process.argv[2] ?? 10);
const withInput = process.argv.includes('--input');

const client = new Client({ name: 'perf-baseline', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/stdio.mjs')], env: process.env }));

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};
const p90 = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round(0.9 * (sorted.length - 1)))];
};

const cases = [
  ['take_screenshot', 'take_screenshot', { max_width: 900 }],
  ['list_elements ax', 'list_elements', {}],
  ['list_elements ocr', 'list_elements', { source: 'ocr' }],
  ['get_foreground_app', 'get_foreground_app', {}],
];
if (withInput) cases.push(['tap (Settings search)', 'tap', { x: 220, y: 148 }]);

for (const [label, name, args] of cases) {
  const walls = [];
  const stages = new Map();
  let failures = 0;
  for (let run = 0; run < runs; run++) {
    const started = performance.now();
    const result = await client.callTool({ name, arguments: args });
    walls.push(Math.round(performance.now() - started));
    if (result.isError) { failures += 1; continue; }
    for (const stage of result._meta?.timing?.stages ?? []) {
      if (stage.parent !== null) continue;
      if (!stages.has(stage.phase)) stages.set(stage.phase, []);
      stages.get(stage.phase).push(stage.elapsed_ms);
    }
  }
  const detail = [...stages].map(([phase, values]) => `${phase} ${median(values)}/${p90(values)}`).join(', ');
  console.log(`${label.padEnd(24)} median ${String(median(walls)).padStart(5)} ms  p90 ${String(p90(walls)).padStart(5)} ms  runs ${walls.length}  failures ${failures}  [${detail}]`);
}

await client.close();
process.exit(0);
