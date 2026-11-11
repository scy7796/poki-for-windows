#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { root } from '../src/config.mjs';

const device = process.argv[2];
const resumeInput = process.argv.includes('--resume-input');
if (!device) throw new Error('Usage: verify-fixture.mjs QA_SIMULATOR_UDID');
const directory = join(root, '.runtime', `acceptance-${Date.now()}`);
await mkdir(directory, { recursive: true, mode: 0o700 });
const client = new Client({ name: 'poki-mcp-real-acceptance', version: '0.2.0' });
const records = [];
const started = Date.now();
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: { device, ...args } }, { timeout: 180000 });
  const content = [];
  for (const block of result.content) {
    if (block.type === 'image') {
      const path = join(directory, `${records.length}-${name}.${block.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`);
      await writeFile(path, Buffer.from(block.data, 'base64'), { mode: 0o600 }); content.push({ path });
    } else content.push(block);
  }
  records.push({ name, arguments: args, isError: !!result.isError, content });
  await writeFile(join(directory, 'results.json'), JSON.stringify({ records, elapsed_ms: Date.now() - started }, null, 2), { mode: 0o600 });
  if (result.isError) throw new Error(`${name}: ${result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')}`);
  console.log(`${name}: completed`);
  try { return JSON.parse(result.content.find(c=>c.type==='text').text); } catch { return result; }
}
const elements = async () => (await call('list_elements', { source: 'accessibility' })).elements;
const find = async name => {
  const list = await elements();
  const hits = list.filter(e => e.identifier === name || e.label === name || e.text === name);
  assert.equal(hits.length, 1, `One visible element matching ${name}`);
  return hits[0];
};
const awaitText = text => call('wait_for', { text, timeout_seconds: 5 });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/stdio.mjs')], env: { ...process.env, POKI_MCP_SESSION: `fixture-${Date.now()}` } }));
  const listing = await call('list_devices');
  assert.ok(listing.devices.some(d => d.id === device && d.kind === 'simulator' && d.name === 'Poki MCP QA'), 'Only operate the dedicated QA simulator');
  await call('select_device');
  await call('launch_app', { bundle_id: 'local.pokimcp.fixture', ...(resumeInput ? {} : { arguments: ['-MCPReset', 'YES'] }) });
  const info = await call('get_device_info');
  assert.ok(info.screen.scale > 1 && info.screen.width > 100);
  const foreground = await call('get_foreground_app');
  assert.equal(foreground.bundle_id, 'local.pokimcp.fixture');
  if (!resumeInput) {
  await awaitText('Count: 0');
  await call('take_screenshot');
  await call('tap_text', { text: 'Increment' }); await awaitText('Count: 1');
  const increment = await find('Increment');
  await call('take_screenshot');
  await call('tap', { ref: increment.ref.toUpperCase() }); await awaitText('Count: 2');
  let gesture = await find('gesture-target'); await call('double_tap', { ref: gesture.ref }); await awaitText('Double tap received');
  gesture = await find('gesture-target'); await call('long_press', { ref: gesture.ref, duration: 0.8 }); await awaitText('Long press received');
  assert.equal((await awaitText('Canvas target')).source, 'ocr');
  assert.equal((await call('scroll_to', { text:'Canvas target', max_scrolls:1 })).source, 'ocr');
  await call('tap_text', { text:'Canvas target' }); await awaitText('Canvas tapped');
  assert.equal((await call('wait_for', { text:'Canvas target', gone:true, timeout_seconds:5 })).source, 'ocr');
  }
  await call('fill', { field: 'test-field', text: 'MCP test' });
  assert.equal((await find('test-field')).value, 'MCP test');
  await call('press_key', { key: 'delete', count: 1 });
  assert.equal((await find('test-field')).value, 'MCP tes');
  await call('type_text', { text: 'MCP restored', clear: true });
  assert.equal((await find('test-field')).value, 'MCP restored');
  await call('hide_keyboard');
  await call('tap_text', { text: 'Show Alert' }); await awaitText('Test Alert');
  await call('handle_alert', { action: 'accept' }); await awaitText('Alert accepted');
  await call('tap_text', { text: 'Open Detail' }); await awaitText('Detail');
  await call('go_back'); await awaitText('Poki MCP Test');
  // Returning to the text field can bring its keyboard back over the lower controls.
  await call('hide_keyboard');
  const slider = (await find('test-slider')).frame;
  await call('drag', { from_x: slider.x + 16, from_y: slider.y + slider.height/2, to_x: slider.x + slider.width-18, to_y: slider.y + slider.height/2, hold_seconds: 0, duration_ms: 500 });
  const sliderValue = (await find('counter')).label;
  assert.match(sliderValue, /Slider: 0\.[89]|Slider: 1\./);
  const zoomBefore = await find('Pinch to zoom');
  const area = zoomBefore.frame;
  await call('pinch', { x: area.x + area.width/2, y: area.y+area.height/2, scale: 1.4 });
  const zoomAfter = await find('Pinch to zoom');
  assert.ok(zoomAfter.frame.width > zoomBefore.frame.width, 'Pinch changes the zoomed view width');
  await call('start_recording');
  await call('swipe', { from_x: info.screen.width/2, from_y: info.screen.height*.8, to_x: info.screen.width/2, to_y: info.screen.height*.3, duration_ms: 350 });
  await call('scroll', { direction: 'down' });
  const bottom = await call('scroll_to', { text: 'Bottom target', direction: 'down', max_scrolls: 12 }); assert.equal(bottom.found,true);
  const recording = await call('stop_recording'); assert.ok(recording.bytes > 1000 && recording.duration_seconds > 0);
  const saved = await call('save_screenshot', { path: join(directory, 'full-resolution.png') }); assert.ok(saved.bytes > 1000);
  await call('take_screenshot');
  await call('press_button', { button: 'home' });
  assert.equal((await call('get_foreground_app')).bundle_id, 'com.apple.springboard');
  await call('launch_app', { bundle_id: 'local.pokimcp.fixture' });
  await call('system_gesture', { gesture: 'go_home' });
  assert.equal((await call('get_foreground_app')).bundle_id, 'com.apple.springboard');
  await writeFile(join(directory, 'PASSED'), `${resumeInput ? 'Core acceptance continued from input' : 'Core interaction acceptance'} passed in ${Date.now()-started} ms\n`, {mode:0o600});
  console.log(`Evidence: ${directory}`);
} finally { await client.close(); }
