#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { root } from '../src/config.mjs';
import { isWin } from '../src/os.mjs';

const device = process.argv[2];
if (!device) throw new Error('Usage: verify-platform.mjs QA_SIMULATOR_UDID');
// Every step below drives a simulator through Xcode, and the first assertion insists on one.
// Saying so beats failing with "Unknown tool: start_simulator".
if (isWin) throw new Error('This acceptance run needs an iOS simulator and Xcode, which this host does not have. It is the macOS platform check; on Windows the equivalent is npm test plus the steps in docs/windows.md.');
const bundle = 'local.pokimcp.fixture';
const directory = join(root,'.runtime',`platform-acceptance-${Date.now()}`);
await mkdir(directory,{recursive:true,mode:0o700});
const client = new Client({name:'poki-mcp-platform-acceptance',version:'0.2.0'});
const records=[]; const started=Date.now();
async function call(name,args={}) {
  const result=await client.callTool({name,arguments:{device,...args}},{timeout:700000});
  const content=[];
  for(const block of result.content) {
    if(block.type==='image') {
      const path=join(directory,`${records.length}-${name}.${block.mimeType==='image/jpeg'?'jpg':'png'}`);
      await writeFile(path,Buffer.from(block.data,'base64'),{mode:0o600});content.push({path});
    } else content.push(block);
  }
  records.push({name,arguments:args,isError:!!result.isError,content});
  await writeFile(join(directory,'results.json'),JSON.stringify({records,elapsed_ms:Date.now()-started},null,2),{mode:0o600});
  if(result.isError) throw new Error(`${name}: ${result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')}`);
  console.log(`${name}: completed`);
  try{return JSON.parse(result.content.find(c=>c.type==='text').text);}catch{return result;}
}
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[join(root,'src/stdio.mjs')],env:{...process.env,POKI_MCP_SESSION:`platform-${Date.now()}`}}));
  const devices=await call('list_devices',{include_all_simulators:true});
  assert.ok(devices.devices.some(d=>d.id===device&&d.kind==='simulator'&&d.name==='Poki MCP QA'));
  await call('start_simulator',{simulator:device});
  await call('select_device');
  const before=await call('get_device_info',{include_settings:true});
  const clipboard=await call('get_clipboard');
  // iOS 27 simulators leave the pasteboard empty after simctl pbcopy. On any other OS the same error is a failure.
  const clipboardWrites=await call('set_clipboard',{text:'Poki MCP platform verification'}).then(()=>true,error=>{
    if(!/^27\./.test(before.osVersion)||!/Clipboard readback differs/.test(error.message)) throw error;
    console.log('set_clipboard: known iOS 27 Simulator limit, write not verified');
    return false;
  });
  if(clipboardWrites) {
    assert.equal((await call('get_clipboard')).text,'Poki MCP platform verification');
    await call('set_clipboard',{text:clipboard.text});
  }
  const build=await call('build_and_run',{project_path:join(root,'bin/fixture-app/PokiMCPFixture.xcodeproj'),scheme:'PokiMCPFixture'});
  assert.equal(build.bundle_id,bundle);
  if (process.argv.includes('--with-core')) {
    const coreLog=join(directory,'core.log');
    try {
      const result=await promisify(execFile)(process.execPath,[join(root,'bin/verify-fixture.mjs'),device],{env:process.env,timeout:300000,maxBuffer:4*1024*1024});
      await writeFile(coreLog,result.stdout+result.stderr,{mode:0o600});
    } catch(error) {
      await writeFile(coreLog,(error.stdout??'')+(error.stderr??error.message),{mode:0o600});
      throw new Error(`Core interaction acceptance failed. See ${coreLog}`);
    }
    console.log(`Core interaction acceptance passed: ${coreLog}`);
    await call('launch_app',{bundle_id:bundle,arguments:['-MCPReset','YES']});
  }
  await call('wait_for',{text:'Count: 0',timeout_seconds:15});
  assert.ok((await call('list_apps')).apps.some(a=>a.bundle_id===bundle));
  await call('tap_text',{text:'Increment'});
  await call('wait_for',{text:'Count: 1',timeout_seconds:5});
  const container=await call('download_app_container',{bundle_id:bundle,destination:directory});
  const state=JSON.parse(await readFile(join(container.path,'AppData/Documents/fixture-state.json'),'utf8'));
  assert.equal(state.count,1);
  await call('set_location',{latitude:12.3,longitude:45.6});
  await call('clear_location');
  assert.equal((await call('set_appearance',{style:'dark'})).appearance,'dark');
  await call('take_screenshot');
  assert.equal((await call('set_appearance',{style:before.settings.appearance})).appearance,before.settings.appearance);
  const settings=await call('set_accessibility',{text_size:'extra_large',increase_contrast:true});
  assert.equal(settings.text_size,'extra_large');assert.equal(settings.increase_contrast,true);
  await call('set_accessibility',{text_size:before.settings.text_size,increase_contrast:before.settings.increase_contrast});
  await call('rotate',{orientation:'landscape_left'});
  const landscape=await call('get_device_info');
  assert.ok(landscape.screen.width>landscape.screen.height,'Landscape changes the actual captured frame dimensions');
  await call('take_screenshot');
  await call('rotate',{orientation:'portrait'});
  await call('open_settings',{page:'about'});
  assert.equal((await call('get_foreground_app')).bundle_id,'com.apple.Preferences');
  await call('open_url',{url:'App-prefs:'});
  assert.equal((await call('get_foreground_app')).bundle_id,'com.apple.Preferences');
  await call('launch_app',{name:'Poki MCP Test',arguments:['-QA','YES'],environment:{MCP_QA:'1'},language:'en',locale:'en_US'});
  await call('wait_for',{text:'Count: 0',timeout_seconds:15});
  await call('scroll_to',{text:'Create test crash',max_scrolls:15});
  const oldReports=await call('list_crashes',{process:bundle,limit:30});
  const oldPaths=new Set(oldReports.reports.map(r=>r.path));
  await call('tap_text',{text:'Create test crash'});
  const deadline=Date.now()+30000; let reports;
  do {
    reports=await call('list_crashes',{process:bundle,limit:30});
    if(reports.reports.some(r=>!oldPaths.has(r.path)))break;
    await call('wait',{seconds:1});
  } while(Date.now()<deadline);
  const crash=reports.reports.find(r=>!oldPaths.has(r.path));
  assert.ok(crash,'A new crash report must be produced by this test');
  const summary=await call('get_crash',{path:crash.path});
  assert.equal(summary.bundle_id,bundle);
  assert.equal(summary.symbolication.matching_build_available,true);
  assert.ok(summary.symbolication.resolved_frames>0,'The actual build dSYM resolves application frames');
  await call('launch_app',{bundle_id:bundle});
  await call('terminate_app',{bundle_id:bundle});
  await call('uninstall_app',{bundle_id:bundle});
  assert.ok(!(await call('list_apps')).apps.some(a=>a.bundle_id===bundle));
  await call('install_app',{path:build.app_path});
  assert.ok((await call('list_apps')).apps.some(a=>a.bundle_id===bundle));
  await call('shut_down_simulator');
  assert.equal((await call('list_devices',{include_all_simulators:true})).devices.find(d=>d.id===device).state,'Shutdown');
  await writeFile(join(directory,'PASSED'),`Platform acceptance passed in ${Date.now()-started} ms\n`,{mode:0o600});
  console.log(`Evidence: ${directory}`);
} finally { await client.close(); }
