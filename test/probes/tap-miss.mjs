// Stage 0, second measurement: how often a tap on a known control actually lands.
//
// The target is the Settings search field, tapped and closed again the way a task would:
// no other app is touched and nothing is submitted. A tap counts as a miss when the search
// interface does not appear, which is what a caller would notice.
//
//   node test/probes/tap-miss.mjs [attempts]
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { join } from 'node:path';
import { root } from '../../src/config.mjs';

const attempts = Number(process.argv[2] ?? 50);
const client = new Client({ name: 'tap-miss', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/stdio.mjs')], env: process.env }));

const call = async (name, args = {}) => {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.find(block => block.type === 'text')?.text ?? '';
  let value;
  try { value = JSON.parse(text); } catch { value = { text }; }
  return { ok: !result.isError, value, wall: Math.round(performance.now() - started) };
};
const elements = async () => (await call('list_elements', {})).value.elements ?? [];
const centre = element => ({ x: element.frame.x + element.frame.width / 2, y: element.frame.y + element.frame.height / 2 });
const searchField = list => list.find(element => element.role === 'SearchField' && element.frame.y > 600);
// Search active: the suggestions sections appear and the field moves up under them.
const searchOpen = list => list.some(element => ['建议', '最近使用', '关闭', '取消'].includes(element.label))
  || list.some(element => element.role === 'SearchField' && element.frame.y < 600);
const atRootMark = list => list.some(element => (element.label ?? '').startsWith('无线局域网')) || Boolean(searchField(list));

// Settings restores the page and the search it was left in, and its search has a close
// button of its own that is the reliable way out; escape only works once text is typed.
async function dismiss() {
  const list = await elements();
  const close = list.find(element => element.role === 'Button' && element.label === '关闭');
  if (close) { await call('tap', centre(close)); }
  else await call('press_key', { key: 'escape' });
  await new Promise(resolve => setTimeout(resolve, 600));
}
async function reachRoot(attempts = 8) {
  for (let step = 0; step < attempts; step++) {
    const list = await elements();
    if (searchField(list) && !searchOpen(list)) return true;
    if (searchOpen(list)) { await dismiss(); continue; }
    const back = list.find(element => element.role === 'Button' && element.frame.y < 120 && element.frame.width <= 70 && element.label);
    await call('tap', back ? centre(back) : { x: 30, y: 82 });
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  const list = await elements();
  return Boolean(searchField(list) && !searchOpen(list));
}

await call('launch_app', { bundle_id: 'com.apple.Preferences', terminate_existing: true });
await new Promise(resolve => setTimeout(resolve, 1200));
if (!(await reachRoot())) {
  console.log('could not reach the Settings root; nothing to measure');
  await client.close();
  process.exit(1);
}

const results = { landed: 0, missed: 0, noField: 0, errors: 0 };
const taps = [];
for (let attempt = 1; attempt <= attempts; attempt++) {
  let list = await elements();
  if (!searchField(list) || searchOpen(list)) {
    if (!(await reachRoot())) { results.noField += 1; console.log(`${attempt}: no search field, and no way back`); continue; }
    list = await elements();
  }
  const field = searchField(list);
  const tapped = await call('tap', centre(field));
  taps.push(tapped.wall);
  await new Promise(resolve => setTimeout(resolve, 500));
  const after = await elements();
  if (searchOpen(after)) {
    results.landed += 1;
    await dismiss();
    await new Promise(resolve => setTimeout(resolve, 300));
  } else {
    results.missed += 1;
    const screen = after.map(element => element.label).filter(Boolean).slice(0, 6).join(' | ');
    console.log(`${attempt}: MISS after ${tapped.wall} ms; screen: ${screen}`);
    await reachRoot();
  }
  if (attempt % 10 === 0) console.log(`${attempt}/${attempts}  landed ${results.landed}  missed ${results.missed}`);
}

const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};
console.log(JSON.stringify({ ...results, attempts, tap_median_ms: median(taps), tap_max_ms: Math.max(0, ...taps) }, null, 2));
await client.close();
process.exit(0);
