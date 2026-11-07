import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readFile, mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { fixture, processGone, value } from './fixture.mjs';
import { isWin } from '../src/os.mjs';

// A simulator is Xcode's; where it does not exist its cases are skipped, not failed.
const needsSimulator = isWin && 'needs the iOS Simulator, which only Xcode provides';
// Recording here runs on faked ffmpeg and screencapture helpers that the macOS suite built around
// POSIX process semantics. The product path works; this rig has not been adapted to Windows yet.
const recordingNotPorted = isWin && 'the recording test rig has not been adapted to Windows yet';
// The approval dialog is a Windows message box, which the fixture does not fake.
const dialogNotFaked = isWin && 'the Windows approval dialog is a message box the fixture does not fake';
// App data containers are copied by devicectl, so the tool is not offered without Xcode.
const containerNeedsXcode = isWin && 'download_app_container is not offered without Xcode';

test('old element refs cannot be reinterpreted by a later element list',async t=>{
 const f=await fixture(t);const first=value(await f.call('list_elements'));
 await f.set({label:'Second'});const second=value(await f.call('list_elements'));
 assert.notEqual(first.elements[0].ref,second.elements[0].ref);
 const tapped=await f.call('tap',{ref:first.elements[0].ref});assert.equal(tapped.isError,true);assert.match(tapped.content[0].text,/stale/);
 assert.equal((await f.events()).filter(e=>e.op==='tap').length,0);
});

test('a system prompt during input is an ordinary failure that stop_on_error decides',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,systemPrompt:true,field:'',typed:'hi',imeResult:'hi'});
 const typing={tool:'type_text',arguments:{text:'hi'}},next={tool:'wait',arguments:{seconds:0}};
 const stopped=summaryOf(await f.call('batch_commands',{commands:[typing,next]}));
 assert.equal(stopped.stop_reason,'error');assert.match(stopped.failed_step.error,/handle_alert/);
 assert.equal(summaryOf(await f.call('batch_commands',{stop_on_error:false,commands:[typing,next]})).completed_steps,2);
});

test('AX miss uses OCR from the same captured observation',async t=>{
 const f=await fixture(t);await f.set({label:'Other'});
 const result=await f.call('wait_for',{text:'Absent',gone:true,timeout:10});assert.ok(!result.isError, JSON.stringify(result));
 const events=await f.events();assert.equal(events.filter(e=>e.args?.includes('screenshot')).length,1);
 assert.equal(events.filter(e=>e.tool==='ocr').length,1);
});


test('two MCP sessions arbitrate aliases, batches and release across HTTP responses', async t => {
 const f=await fixture(t), b=await f.connect(), callB=(name,args={})=>b.callTool({name,arguments:args});
 await f.call('list_devices');
 const lease=value(await f.call('acquire_device',{device:'Fixture Phone',ttl_seconds:10}));assert.ok(lease.lease_id);
 const listed=value(await callB('list_devices'));assert.equal(listed.devices[0].occupied,true);assert.equal(listed.devices[0].owned_by_session,false);
 for(const [name,args] of [['take_screenshot',{device:'fixture-phone'}],['tap',{device:'Fixture Phone',x:10,y:10}],['list_elements',{}],['batch_commands',{commands:[{tool:'press_key',arguments:{device:'fixture-phone',key:'return'}}]}],['acquire_device',{device:'fixture-phone'}],['renew_device',{lease_id:lease.lease_id}],['release_device',{lease_id:lease.lease_id}]]) assert.equal((await callB(name,args)).isError,true,name);
 assert.equal((await f.events()).filter(e=>['tap','key'].includes(e.op)).length,0);
 const renewed=value(await f.call('renew_device',{lease_id:lease.lease_id,ttl_seconds:30}));assert.ok(Date.parse(renewed.expires_at)>Date.parse(lease.expires_at));
 assert.ok(!(await f.call('take_screenshot')).isError);
 assert.equal(value(await f.call('release_device',{lease_id:lease.lease_id})).reason,'released');
 assert.ok(value(await callB('acquire_device',{device:'fixture-phone'})).lease_id);
});

test('cancel bypasses the queue, retains a batch prefix, invalidates queued calls and allows takeover',async t=>{
 const f=await fixture(t),b=await f.connect();const lease=value(await f.call('acquire_device',{device:'fixture-phone'}));
 await f.set({block:'ax_tree'});
 const batch=f.call('batch_commands',{stop_on_error:false,commands:[{tool:'press_key',arguments:{key:'return'}},{tool:'list_elements'},{tool:'tap',arguments:{x:10,y:10}}]});
 await f.until(log=>log.includes('"op":"ax_tree"'));
 const queued=f.call('press_key',{key:'return'});
 const cancelled=value(await f.call('cancel_device',{lease_id:lease.lease_id}));assert.equal(cancelled.reason,'cancelled');assert.equal(cancelled.cancelled_operations,2);
 const result=await batch;assert.equal(result.isError,true);assert.ok(result.content.some(c=>c.text?.includes('"sent": true')));assert.ok(result.content.some(c=>c.text?.includes('"stop_reason": "cancelled"')));
 assert.equal((await queued).isError,true);
 assert.equal((await f.events()).filter(e=>e.op==='key').length,1);assert.equal((await f.events()).filter(e=>e.op==='tap').length,0);
 assert.ok(value(await b.callTool({name:'acquire_device',arguments:{device:'fixture-phone'}})).lease_id);
});

test('lease expiry stops accepted work and stdio exit releases a renewed lease',async t=>{
 const f=await fixture(t),b=await f.connect();
 const lease=value(await f.call('acquire_device',{device:'fixture-phone',ttl_seconds:1}));assert.ok(lease.lease_id);
 const result=await f.call('wait',{seconds:30});assert.equal(result.isError,true);assert.match(result.content[0].text,/expired/);assert.equal(result._meta.stop_reason,'expired');
 const next=value(await b.callTool({name:'acquire_device',arguments:{device:'fixture-phone',ttl_seconds:60}}));assert.ok(next.lease_id);
 await b.close();
 // Closing stdio sends a session cleanup request; the client transport waits for exit.
 assert.ok(value(await f.call('acquire_device',{device:'fixture-phone'})).lease_id);
});

test('SDK cancellation reaches an owned external process without a device lease',async t=>{
 const f=await fixture(t);await f.set({block:'ax_tree'});
 const controller=new AbortController();
 const pending=f.a.callTool({name:'list_elements',arguments:{}},{signal:controller.signal});
 const rejected=assert.rejects(pending);
 await f.until(log=>log.includes('"op":"ax_tree"'));controller.abort();await rejected;
 const result=await f.call('wait',{seconds:0});assert.ok(!result.isError);
 assert.equal((await f.events()).filter(e=>e.op==='ax_tree').length,1);
});

test('wait_for deadline includes an in-flight device read and prevents OCR after timeout',async t=>{
 const f=await fixture(t);await f.set({block:'ax_tree'});
 const started=performance.now();const result=await f.call('wait_for',{text:'First',timeout:1});
 assert.equal(result.isError,true);assert.ok(performance.now()-started<2500);assert.match(result.content[0].text,/deadline|timed out/i);
 assert.equal((await f.events()).filter(e=>e.tool==='ocr').length,0);
});

test('observations bind image and structure, share prompt OCR, and invalidate refs on known changes',async t=>{
 const f=await fixture(t);const observed=await f.call('observe_device',{source:'ocr'}),first=value(observed);
 assert.ok(observed.content.some(c=>c.type==='image'));assert.equal(first.observation.atomic,false);assert.equal(first.observation.device,'fixture-phone');assert.equal(first.observation.width,100);assert.ok(first.observation.capture_started_at<=first.observation.structure_completed_at);
 assert.equal((await f.events()).filter(e=>e.tool==='ocr').length,1);
 assert.ok(observed._meta.timing.stages.every(stage => Number.isFinite(stage.elapsed_ms) && stage.elapsed_ms >= 0));
 assert.ok(!JSON.stringify(observed._meta.timing).includes('fixture-phone'));
 t.diagnostic('observation timing (ms): '+JSON.stringify(observed._meta.timing));
 const b=await f.connect();assert.ok(!(await b.callTool({name:'tap',arguments:{x:10,y:10}})).isError);
 assert.equal((await f.call('tap',{ref:first.elements[0].ref})).isError,true);
 const second=value(await f.call('list_elements'));
 await sharp({create:{width:100,height:200,channels:3,background:'black'}}).png().toFile(f.image);
 await f.call('take_screenshot');assert.equal((await f.call('tap',{ref:second.elements[0].ref})).isError,true);
 const matched=value(await f.call('wait_for',{text:'First',timeout:2}));assert.ok(matched.observation.id);assert.equal(matched.matched,true);
});

test('input receipt survives recording recovery failure and stopping prevents revival',{skip:recordingNotPorted},async t=>{
 const f=await fixture(t);assert.equal(value(await f.call('start_recording')).recording,true);
 await f.set({failRecording:true});
 const input=await f.call('type_text',{text:'Fixture',submit:true});assert.ok(!input.isError,input.content[0].text);const first=value(input);
 assert.equal(first.sent,true);assert.equal(first.text_verified,true);assert.equal(first.submit_sent,true);assert.equal(first.recording.resumed,false);
 for(let i=0;i<4;i++)assert.equal(value(await f.call('press_key',{key:'return'})).sent,true);
 assert.equal((await f.events()).filter(e=>e.args?.includes('screencapture')).length,6);
 const stopped=value(await f.call('stop_recording'));assert.equal(stopped.recording,false);assert.equal(stopped.input_reconnects,5);assert.equal(stopped.automatic_retries,0);
 await f.call('press_key',{key:'return'});assert.equal((await f.events()).filter(e=>e.args?.includes('screencapture')).length,6);
});

test('cancel interrupts the human dialog process and never executes the approved action',{skip:dialogNotFaked},async t=>{
 const f=await fixture(t);const pending=f.call('open_url',{url:'https://example.invalid'});
 await f.until(log=>log.includes('"dialog":true'));
 const cancelled=value(await f.call('cancel_device'));assert.equal(cancelled.stopped,true);assert.equal((await pending).isError,true);
 assert.equal((await f.events()).filter(e=>e.args?.includes('open')).length,0);
});


test('an occupied simulator cannot be booted through explicit, selected or batch paths',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true});
 assert.ok(value(await f.call('acquire_device',{device:'fixture-sim'})).lease_id);
 const b=await f.connect();
 for(const [name,args] of [['start_simulator',{simulator:'Fixture Simulator'}],['select_device',{device:'fixture-sim'}],['take_screenshot',{device:'Fixture Simulator'}],['batch_commands',{commands:[{tool:'start_simulator',arguments:{simulator:'fixture-sim'}}]}]])assert.equal((await b.callTool({name,arguments:args})).isError,true,name);
 assert.equal((await f.events()).filter(e=>e.args?.some(a=>['boot','spawn','bootstatus','create'].includes(a))).length,0);
});

test('cancel during recording recovery preserves dispatched input and finishes cleanup before takeover',{skip:recordingNotPorted},async t=>{
 const f=await fixture(t),b=await f.connect();const lease=value(await f.call('acquire_device',{device:'fixture-phone'}));
 await f.call('start_recording');await f.set({recordingBlock:true});
 const input=f.call('type_text',{text:'Fixture',submit:true});
 await f.until(log=>log.split('screencapture').length===3);
 const stop=value(await f.call('cancel_device',{lease_id:lease.lease_id}));
 const response=await input, result=value(response);assert.equal(result.sent,true);assert.equal(result.text_verified,true);assert.equal(result.submit_sent,true);assert.equal(result.recording.resumed,false);
 assert.equal(response._meta.cleanup.recordings[0].recording,false);assert.equal(stop.reason,'cancelled');
 assert.ok(value(await b.callTool({name:'acquire_device',arguments:{device:'fixture-phone'}})).lease_id);
 assert.equal((await f.events()).filter(e=>e.args?.includes('screencapture')).length,2);
});


test('request cancellation leaves another device and another session recording intact',{skip:recordingNotPorted},async t=>{
 const f=await fixture(t),b=await f.connect();await f.set({twoPhones:true});
 await f.call('start_recording',{device:'fixture-phone'});
 await b.callTool({name:'start_recording',arguments:{device:'fixture-phone-2'}});
 await f.set({twoPhones:true,block:'ax_tree'});
 const controller=new AbortController();const pending=f.a.callTool({name:'list_elements',arguments:{device:'fixture-phone-2'}},{signal:controller.signal});const rejected=assert.rejects(pending);
 await f.until(log=>log.includes('"op":"ax_tree"'));controller.abort();await rejected;
 assert.equal(value(await f.call('stop_recording',{device:'fixture-phone'})).recording,false);
 assert.equal(value(await b.callTool({name:'stop_recording',arguments:{device:'fixture-phone-2'}})).recording,false);
});


test('healthy recording survives more than four inputs without consuming automatic retry budget',{skip:recordingNotPorted},async t=>{
 const f=await fixture(t);await f.set({inputStopsRecording:true});assert.equal(value(await f.call('start_recording')).recording,true);
 for(let i=0;i<5;i++){
  const result=value(await f.call('press_key',{key:'return'}));
  assert.equal(result.sent,true);assert.notEqual(result.recording?.resumed,false,`input ${i+1}: ${JSON.stringify(result.recording)}`);
 }
 await f.set({inputStopsRecording:true,inputError:true});
 const failed=await f.call('press_key',{key:'return'});assert.equal(failed.isError,true);assert.equal(value(failed).outcome,'unknown');
 const stopped=value(await f.call('stop_recording'));
 assert.equal(stopped.recording,false);assert.equal(stopped.input_reconnects,6);assert.equal(stopped.automatic_retries,0);
});

test('automatic recording retries remain bounded after repeated unexpected disconnects',{skip:recordingNotPorted},async t=>{
 const f=await fixture(t);await f.call('start_recording');
 for(let count=1;count<=4;count++){
  await f.until(log=>log.split('"encoded":true').length-1>=count);
  const receiver=(await f.events()).filter(e=>e.args?.includes('screencapture')).at(-1);
  process.kill(receiver.pid,'SIGTERM');
 }
 // A real discovery request lets the server process the receiver close event.
 await f.call('poki_mcp_status');
 const stopped=value(await f.call('stop_recording'));
 assert.equal(stopped.automatic_retries,3);assert.equal(stopped.input_reconnects,0);
 assert.match(stopped.recovery_error,/retry limit/);
 assert.equal((await f.events()).filter(e=>e.args?.includes('screencapture')).length,4);
});

test('renewal and rejected management calls preserve SDK cancellation identity',async t=>{
 const f=await fixture(t);const lease=value(await f.call('acquire_device',{device:'fixture-phone'}));
 for(const [name,args,shouldFail] of [
  ['renew_device',{lease_id:lease.lease_id},false],
  ['renew_device',{lease_id:'wrong-owner'},true],
  ['release_device',{lease_id:'wrong-owner'},true],
  ['cancel_device',{lease_id:'wrong-owner'},true],
 ]){
  await f.set({block:'ax_tree'});const before=(await f.events()).filter(e=>e.op==='ax_tree').length;
  const controller=new AbortController();const pending=f.a.callTool({name:'list_elements',arguments:{}},{signal:controller.signal});const rejected=assert.rejects(pending);
  await f.until(log=>log.split('"op":"ax_tree"').length-1>before);
  const native=(await f.events()).filter(e=>e.tool==='poki-native').at(-1);
  const managed=await f.call(name,args);assert.equal(Boolean(managed.isError),shouldFail);
  controller.abort();await rejected;
  const available=await f.a.callTool({name:'wait',arguments:{seconds:0}},{timeout:1500});assert.ok(!available.isError);
    // Windows keeps a terminated process object alive while handles remain, so the
    // liveness question is answered from the process table there.
    const ended = await processGone(native.pid);
    assert.ok(ended, 'the native helper should have ended');
 }
});

test('recognized prompts report their type without forcing a human handoff',async t=>{
 for(const [tool,args,label,kind] of [
  ['handle_alert',{action:'accept'},'Allow Paste','paste'],
  ['handle_alert',{button:'允许粘贴'},'允许粘贴','paste'],
  ['handle_alert',{action:'dismiss'},"Don't Allow Paste",'paste'],
  ['take_screenshot',{},'Enter iPhone Passcode','passcode'],
  ['observe_device',{},'Apple Account Password','apple_account'],
  ['list_elements',{},'账户密码','apple_account'],
  ['list_elements',{},'面容 ID','face_id'],
  ['list_elements',{},'Face ID','face_id'],
  ['list_elements',{},'触控 ID','touch_id'],
  ['list_elements',{},'Touch ID','touch_id'],
  ['list_elements',{},'“VPN”想添加 VPN 配置','vpn'],
  ['list_elements',{},'「VPN」想要加入 VPN 設定','vpn'],
  ['list_elements',{},'安装描述文件','profile'],
  ['list_elements',{},'安裝描述檔','profile'],
 ]) await t.test(`${tool}: ${label}`,async t=>{
  const f=await fixture(t);await f.set({label,...(tool==='handle_alert'?{afterInput:{label:'Alert accepted'}}:{})});
  const result=await f.call('batch_commands',{commands:[{tool:'wait',arguments:{seconds:0}},{tool,arguments:args},{tool:'wait',arguments:{seconds:0}}]});
  assert.notEqual(result.isError,true,JSON.stringify(result.content.filter(c=>c.type==='text')));
  const summary=value({content:[result.content.at(-1)]});assert.equal(summary.completed_steps,3);assert.equal(summary.stop_reason,null);
  const texts=result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  assert.match(texts,new RegExp(`"kind":\\s*"${kind}"`));
  assert.doesNotMatch(texts,/requires the user|request_human_action|do not answer it automatically/);
  if(tool==='handle_alert')assert.ok(summary.screen.text.some(text=>text.includes('Alert accepted')));
  if(['take_screenshot','observe_device'].includes(tool))assert.ok(result.content.some(c=>c.type==='image'));
  if(tool==='observe_device')assert.ok(result.content.some(c=>c.text?.includes('"structure_source": "accessibility"')));
 });
});


const purchaseElements = [
 {label:'确认购买',role:'StaticText',frame:{x:10,y:10,width:80,height:20}},
 {label:'确定',role:'Button',frame:{x:10,y:60,width:30,height:20}},
 {label:'取消',role:'Button',frame:{x:60,y:60,width:30,height:20}},
];

test('purchase prompts require a button label before generic acceptance can tap',async t=>{
 const f=await fixture(t);
 await f.set({elements:purchaseElements,afterInput:{elements:null,label:'Purchase confirmed'}});
 const result=await f.call('handle_alert',{action:'accept'}),reply=value(result);
 assert.equal(reply.sent,false);
 assert.equal(reply.prompt.kind,'purchase');
 assert.deepEqual(reply.buttons,['确定','取消']);
 assert.notEqual(reply.needs_human_action,true);
 assert.match(reply.instruction,/button/);
 assert.equal((await f.events()).filter(e=>e.op==='tap').length,0);
 const screen=value(await f.call('list_elements'));
 assert.ok(screen.elements.some(e=>e.label==='确认购买'));
 t.diagnostic(JSON.stringify({request:{action:'accept'},reply,screen:screen.elements.map(e=>e.label)}));
});

test('purchase prompts allow an explicit button and generic dismissal',async t=>{
 const f=await fixture(t);
 for(const [args,after] of [
  [{button:'确定'},'Purchase confirmed'],
  [{action:'accept',button:'确定'},'Purchase confirmed'],
  [{action:'dismiss'},'Purchase cancelled'],
 ]){
  await f.set({elements:purchaseElements,afterInput:{elements:null,label:after}});
  const result=await f.call('handle_alert',args),reply=value(result);
  assert.notEqual(result.isError,true,JSON.stringify(reply));
  assert.equal(reply.sent,true);
  assert.equal(reply.prompt.kind,'purchase');
  assert.ok(reply.screen.text.some(text=>text.includes(after)),JSON.stringify(reply));
  const lastTap=(await f.events()).filter(e=>e.op==='tap').at(-1).request;
  assert.equal(lastTap.x < 32768,args.action!=='dismiss');
  t.diagnostic(JSON.stringify({request:args,reply}));
 }
});


test('wireless Settings and app launch use the paired device when host CoreDevice cannot discover it',async t=>{
 const f=await fixture(t);await f.set({coreDeviceUnavailable:true});
 const settings=await f.call('open_settings');
 assert.notEqual(settings.isError,true,settings.content[0].text);
 assert.equal(value(settings).launched,true);
 assert.equal(value(settings).pid,4242);
 const launched=await f.call('launch_app',{name:'Settings',arguments:['--example'],environment:{MODE:'test'},language:'en',locale:'en_US'});
 assert.notEqual(launched.isError,true,launched.content[0].text);
 assert.equal(value(launched).pid,4242);
 const commands=(await f.events()).filter(e=>e.op==='launch_app').map(e=>e.request);
 assert.equal(commands[0].terminate_existing,false);
 assert.equal(commands[1].bundle_id,'com.apple.Preferences');
 assert.deepEqual(commands[1].arguments,['--example','-AppleLanguages','(en)','-AppleLocale','en_US']);
 assert.deepEqual(commands[1].environment,{MODE:'test'});
 assert.equal(commands[1].terminate_existing,true);
 await f.set({coreDeviceUnavailable:true,launchError:true});
 const failed=await f.call('launch_app',{bundle_id:'com.apple.Preferences'});
 assert.equal(failed.isError,true);
 assert.match(failed.content[0].text,/Launch service rejected/);
 await f.set({coreDeviceUnavailable:true,axUnavailable:true});
 const unverified=await f.call('launch_app',{bundle_id:'com.apple.Preferences'});
 assert.equal(unverified.isError,true);
 assert.match(unverified.content[0].text,/Foreground observation unavailable/);
});


test('uncertain launches stop permissive batches and preserve the accepted prefix and launch receipt',async t=>{
 const f=await fixture(t);
 for(const [tool,state,pid] of [
  ['launch_app',{axUnavailable:true},4242],
  ['open_settings',{axUnavailable:true},4242],
  ['launch_app',{launchError:true},undefined],
  ['launch_app',{invalidPid:true},0],
 ]){
  await f.set(state);const before=(await f.events()).length;
  const result=await f.call('batch_commands',{stop_on_error:false,commands:[{tool:'wait',arguments:{seconds:0}},{tool,arguments:tool==='launch_app'?{bundle_id:'com.apple.Preferences'}:{}},{tool:'tap',arguments:{x:10,y:10}}]});
  const entries=result.content.flatMap(c=>{try{return c.type==='text'?[JSON.parse(c.text)]:[];}catch{return [];}});
  assert.equal(entries.at(-1).completed_steps,2);
  assert.equal(entries.at(-1).stop_reason,'unknown');
  const receipt=entries.find(e=>e.outcome==='unknown');assert.ok(receipt);
  assert.equal(receipt.foreground_verified,false);
  if(pid!==undefined){assert.equal(receipt.pid,pid);if(pid>0)assert.equal(receipt.launched,true);}
  assert.equal((await f.events()).slice(before).filter(e=>e.op==='tap').length,0);
 }
 for(const args of [{}, {name:'Missing app'}]){
  await f.set({launchNotSent:true});
  const result=await f.call('batch_commands',{stop_on_error:false,commands:[{tool:'launch_app',arguments:args},{tool:'wait',arguments:{seconds:0}}]});
  const summary=JSON.parse(result.content.at(-1).text);
  assert.equal(summary.completed_steps,2);assert.equal(summary.stop_reason,null);
 }
});

test('a verified launch continues its batch when screenshots are unavailable, but a different foreground stops it',async t=>{
 const f=await fixture(t);
 const commands=[{tool:'launch_app',arguments:{bundle_id:'com.apple.Preferences'}},{tool:'wait',arguments:{seconds:0}}];
 await f.set({screenshotUnavailable:true});
 const result=await f.call('batch_commands',{commands});
 assert.notEqual(result.isError,true,JSON.stringify(result));
 const receipt=JSON.parse(result.content[1].text);
 assert.equal(receipt.launched,true);
 assert.equal(receipt.foreground_verified,true);
 assert.equal(summaryOf(result).completed_steps,2);
 assert.equal(summaryOf(result).stop_reason,null);
 assert.match(summaryOf(result).screen.unavailable,/Screenshot service unavailable/);
 await f.set({foregroundPid:999,screenshotUnavailable:true});
 const wrong=await f.call('batch_commands',{commands,stop_on_error:false});
 assert.equal(wrong.isError,true);
 assert.equal(JSON.parse(wrong.content[1].text).foreground_verified,false);
 assert.equal(summaryOf(wrong).completed_steps,1);
 assert.equal(summaryOf(wrong).stop_reason,'unknown');
});

test('launch reconnects a stalled foreground observation without relaunching the app',async t=>{
 const f=await fixture(t);await f.set({axHangs:1});
 const result=await f.a.callTool({name:'launch_app',arguments:{bundle_id:'com.apple.Preferences'}},{timeout:6500});
 assert.notEqual(result.isError,true,result.content[0].text);
 assert.equal(value(result).foreground_verified,true);
 const events=await f.events();assert.equal(events.filter(e=>e.op==='launch_app').length,1);
 const processes=events.filter(e=>e.tool==='poki-native');
 for(const process of processes)assert.ok(await processGone(process.pid),'every native helper should have ended');
 await f.set({axHangs:10});const start=events.length,controller=new AbortController();
 const pending=f.a.callTool({name:'launch_app',arguments:{bundle_id:'com.apple.Preferences'}},{signal:controller.signal});
 const rejected=assert.rejects(pending);
 await f.until(log=>log.trim().split('\n').map(JSON.parse).slice(start).some(e=>e.op==='ax_tree'));
 controller.abort();await rejected;
 assert.notEqual((await f.call('wait',{seconds:0})).isError,true);
 const cancelled=(await f.events()).slice(start);
 assert.equal(cancelled.filter(e=>e.op==='launch_app').length,1);
 assert.equal(cancelled.filter(e=>e.op==='ax_tree').length,1);
});


test('paired application listing survives missing host discovery and preserves system filtering',async t=>{
 const f=await fixture(t);await f.set({coreDeviceUnavailable:true});
 const installed=await f.call('list_apps');assert.notEqual(installed.isError,true,installed.content[0].text);
 assert.deepEqual(value(installed).apps.map(a=>a.bundle_id),['local.fixture']);
 assert.equal(value(installed).apps[0].version,'2.0');assert.equal(value(installed).apps[0].developer,true);
 const all=await f.call('list_apps',{include_system:true});assert.notEqual(all.isError,true,all.content[0].text);
 assert.deepEqual(value(all).apps.map(a=>a.bundle_id),['com.apple.Preferences','local.fixture']);
});


test('unknown container eligibility is decided by the copy service rather than rejected by app listing',{skip:containerNeedsXcode},async t=>{
 const f=await fixture(t,{approvalMode:'allow'});
 const downloaded=await f.call('download_app_container',{bundle_id:'local.fixture',destination:f.dir+'/exports'});
 assert.notEqual(downloaded.isError,true,downloaded.content[0].text);
 const exported=value(downloaded);
 assert.equal(await readFile(exported.path+'/AppData/Documents/check.txt','utf8'),'fixture container contents');
 assert.match(await readFile(exported.path+'/AppDataInfo.plist','utf8'),/local.fixture/);
 await f.set({denyContainer:true});
 const denied=await f.call('download_app_container',{bundle_id:'local.fixture',destination:f.dir+'/exports'});
 assert.equal(denied.isError,true);assert.match(denied.content[0].text,/Container access denied by device/);
});


test('paired install and uninstall verify inventory, and uncertain installation stops permissive batches', async t => {
 const f=await fixture(t,{approvalMode:'allow'});await f.set({coreDeviceUnavailable:true});
 const app=f.dir+'/InstallFixture.app';await mkdir(app);await writeFile(app+'/Info.plist','<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.installfixture</string></dict></plist>');
 const installed=await f.call('install_app',{path:app});assert.ok(!installed.isError,JSON.stringify(installed));assert.equal(value(installed).bundle_id,'local.installfixture');assert.equal(value(installed).installed,true);
 assert.ok(value(await f.call('list_apps')).apps.some(a=>a.bundle_id==='local.installfixture'));
 const removed=await f.call('uninstall_app',{bundle_id:'local.installfixture'});assert.ok(!removed.isError,JSON.stringify(removed));assert.equal(value(removed).uninstalled,'local.installfixture');
 assert.ok(!value(await f.call('list_apps')).apps.some(a=>a.bundle_id==='local.installfixture'));
 await f.set({coreDeviceUnavailable:true,installUnknown:true});
 const uncertain=await f.call('batch_commands',{stop_on_error:false,commands:[{tool:'install_app',arguments:{path:app}},{tool:'tap',arguments:{x:10,y:10}}]});
 assert.equal(uncertain.isError,true);assert.equal(JSON.parse(uncertain.content.at(-1).text).stop_reason,'unknown');assert.ok(uncertain.content.some(c=>c.text?.includes('Connection closed after sending request')));assert.equal((await f.events()).filter(e=>e.op==='tap').length,0);
});


test('completed application mutations retain service confirmation when inventory verification fails',async t=>{
 const f=await fixture(t,{approvalMode:'allow'});
 const app=f.dir+'/InstallFixture.app';await mkdir(app);await writeFile(app+'/Info.plist','<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.installfixture</string></dict></plist>');
 for(const [tool,args] of [['install_app',{path:app}],['uninstall_app',{bundle_id:'local.installfixture'}]]){
  await f.set({installed:true,failInventoryAfterMutation:true});
  const result=await f.call(tool,args),receipt=value(result);
  assert.equal(result.isError,true);assert.equal(receipt.outcome,'completed');assert.equal(receipt.inventory_verified,false);assert.equal(receipt.verification_outcome,'unknown');assert.equal(result._meta.stop_reason,'unknown');
 }
});

test('interrupted installation retains a private recovery record for its exact device staging directory',async t=>{
 const f=await fixture(t,{approvalMode:'allow'});
 const app=f.dir+'/InstallFixture.app';await mkdir(app);await writeFile(app+'/Info.plist','<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.installfixture</string></dict></plist>');
 for(const reason of ['cancelled','expired']){
  await f.set({block:'install_app'});const before=(await f.events()).length;
  const lease=value(await f.call('acquire_device',{device:'fixture-phone',ttl_seconds:reason==='expired'?1:60}));
  const pending=f.call('install_app',{path:app});
  await f.until(log=>log.trim().split('\n').slice(before).some(line=>JSON.parse(line).op==='install_app'));
  if(reason==='cancelled')await f.call('cancel_device',{lease_id:lease.lease_id});
  const result=await pending,receipt=value(result);assert.equal(result.isError,true);assert.equal(result._meta.stop_reason,reason);
  const record=JSON.parse(await readFile(receipt.recovery_record,'utf8'));assert.equal(record.bundle_id,'local.installfixture');assert.equal(record.device_id,'fixture-phone');
  assert.match(record.device_staging_directory,/^PublicStaging\/poki-[0-9a-f-]{36}$/);assert.equal(record.status,'unknown');
  const request=(await f.events()).slice(before).find(e=>e.op==='install_app').request;assert.equal(record.device_staging_directory,'PublicStaging/poki-'+request.staging_id);
  // Windows carries access as ACLs and reports no POSIX bits, so the check there is that
  // the record exists and the service owns it, not a particular octal value.
  if (isWin) { assert.ok((await stat(receipt.recovery_record)).isFile()); assert.ok((await stat(f.env.POKI_MCP_STATE_DIR+'/install/operations')).isDirectory()); }
  else { assert.equal((await stat(receipt.recovery_record)).mode&0o777,0o600);assert.equal((await stat(f.env.POKI_MCP_STATE_DIR+'/install/operations')).mode&0o777,0o700); }
 }
});

const summaryOf=result=>value({content:[result.content.at(-1)]});
const touches=events=>events.filter(e=>e.op==='hid'&&e.request.events.some(event=>event.messageType==='IndigoDigitizerEvent')).length;

test('a wrong later step stops the batch before any step runs',async t=>{
 const f=await fixture(t);
 const result=await f.call('batch_commands',{commands:[{tool:'tap',arguments:{x:10,y:10}},{tool:'tap_txt',arguments:{text:'First'}}]});
 assert.equal(result.isError,true);
 assert.equal((await f.events()).filter(e=>e.op==='tap').length,0);
 const summary=summaryOf(result);
 assert.equal(summary.failed_step.step,2);assert.match(summary.failed_step.error,/Did you mean .*tap_text/);
 assert.equal(summary.remaining_steps.length,2);
});

test('a batch accepts the prefixed tool name a client shows to its model',async t=>{
 const f=await fixture(t);
 const result=await f.call('batch_commands',{commands:[{tool:'mcp__poki-mcp__wait',arguments:{seconds:0}}]});
 assert.notEqual(result.isError,true,JSON.stringify(result.content));
});

test('tap_text waits for a target that appears after it was called',async t=>{
 const f=await fixture(t);await f.set({label:'Ready',appearsAfterReads:3});
 const result=await f.call('tap_text',{text:'Ready'});
 assert.notEqual(result.isError,true,result.content[0].text);
 assert.equal((await f.events()).filter(e=>e.op==='tap').length,1);
});

test('a target only text recognition can read is tapped where it holds still, not where the deadline caught it',async t=>{
 const f=await fixture(t);await f.set({label:'Other',ocrLabel:'Canvas target',ocrXs:[10,20,30,40]});
 const result=await f.call('tap_text',{text:'Canvas target'});
 assert.notEqual(result.isError,true,result.content[0].text);
 const taps=(await f.events()).filter(e=>e.op==='tap');
 assert.equal(taps.length,1);
 assert.deepEqual([taps[0].request.x,taps[0].request.y],[39718,6586]);
});

test('a missing target taps nothing and lets the next call fix only that step',async t=>{
 const f=await fixture(t);await f.set({label:'Open Detail'});
 const result=await f.call('batch_commands',{commands:[{tool:'wait',arguments:{seconds:0}},{tool:'tap_text',arguments:{text:'Open Details'}},{tool:'press_key',arguments:{key:'return'}}]});
 assert.equal(result.isError,true);
 assert.equal((await f.events()).filter(e=>e.op==='tap'||e.op==='key').length,0);
 const summary=summaryOf(result);
 assert.equal(summary.stop_reason,'error');
 assert.equal(summary.failed_step.step,2);assert.match(summary.failed_step.error,/Closest on screen: "Open Detail"/);
 assert.deepEqual(summary.remaining_steps.map(step=>step.tool),['tap_text','press_key']);
 assert.ok(summary.screen.text.includes('Button: Open Detail'));
 assert.match(summary.next,/do not repeat/);
});

test('scroll reports whether the screen moved and what it now shows',async t=>{
 const f=await fixture(t);await f.set({label:'Row 1',afterInput:{label:'Row 9'}});
 const moved=value(await f.call('scroll',{direction:'down'}));
 assert.equal(moved.screen_change_verified,true);assert.equal(moved.screen_changed,true);
 assert.ok(moved.screen.text.includes('Button: Row 9'));
 const atEnd=value(await f.call('scroll',{direction:'down'}));
 assert.equal(atEnd.screen_change_verified,true);assert.equal(atEnd.screen_changed,false);
});

test('a tap that accessibility cannot read back reports the screen from OCR',async t=>{
 const f=await fixture(t);await f.set({afterInput:{axUnavailable:true}});
 const result=await f.call('tap',{x:10,y:10});
 assert.notEqual(result.isError,true,result.content[0].text);
 const receipt=value(result);
 assert.equal(receipt.sent,true);assert.equal(receipt.screen_change_verified,false);assert.equal(receipt.screen.source,'ocr');
});

test('a delivered tap stays a success when neither accessibility nor OCR can read the screen',async t=>{
 const f=await fixture(t);await f.set({afterInput:{axUnavailable:true,ocrUnavailable:true}});
 const result=await f.call('tap',{x:10,y:10});
 assert.notEqual(result.isError,true,result.content[0].text);
 const receipt=value(result);
 assert.equal(receipt.sent,true);assert.equal(receipt.screen_change_verified,false);assert.match(receipt.screen.unavailable,/Text recognition unavailable/);
});

test('a tap that leaves the screen as it was when its target was found says no change was observed',async t=>{
 const f=await fixture(t);await f.set({label:'Ready',appearsAfterReads:3});
 const receipt=value(await f.call('tap_text',{text:'Ready'}));
 assert.equal(receipt.sent,true);assert.equal(receipt.screen_changed,false);
 assert.match(receipt.instruction,/no change was observed/);
 assert.equal((await f.events()).filter(e=>e.op==='tap').length,1);
});

test('a batch pauses before the steps that follow a tap with no observed change, and names the step to check',async t=>{
 const f=await fixture(t);await f.set({label:'Open'});
 const result=await f.call('batch_commands',{commands:[{tool:'tap_text',arguments:{text:'Open'}},{tool:'press_key',arguments:{key:'return'}}]});
 assert.equal(result.isError,true);
 assert.equal((await f.events()).filter(e=>e.op==='key').length,0);
 const summary=summaryOf(result);
 assert.equal(summary.stop_reason,'no_change');assert.equal(summary.unchanged_step.step,1);
 assert.deepEqual(summary.remaining_steps.map(step=>step.tool),['press_key']);
 assert.match(summary.next,/no change was observed/);
 const last=await f.call('batch_commands',{commands:[{tool:'tap_text',arguments:{text:'Open'}}]});
 assert.notEqual(last.isError,true,JSON.stringify(last.content));
 assert.equal(summaryOf(last).stop_reason,null);
 assert.match(replyOf(last.content[1]).instruction,/no change was observed/);
});

test('a tap that only changes what is selected counts as a change, and the batch goes on',async t=>{
 const f=await fixture(t);await f.set({label:'Daily',afterInput:{selected:true}});
 const single=await f.call('tap_text',{text:'Daily'}),receipt=value(single);
 assert.equal(receipt.screen_changed,true);assert.equal(receipt.instruction,undefined);assert.equal(single._meta?.stop_reason,undefined);
 await f.set({label:'Daily',afterInput:{selected:true}});
 const result=await f.call('batch_commands',{commands:[{tool:'tap_text',arguments:{text:'Daily'}},{tool:'press_key',arguments:{key:'return'}}]});
 assert.notEqual(result.isError,true,JSON.stringify(result.content));
 assert.equal((await f.events()).filter(e=>e.op==='key').length,1);
});

test('the application itself is not a tap target, even when the text is its name',async t=>{
 const f=await fixture(t);await f.set({appRoot:'Fixture',label:'Open'});
 const result=await f.call('tap_text',{text:'Fixture'});
 assert.equal(result.isError,true);assert.match(result.content[0].text,/No visible element matches "Fixture"/);
 assert.equal((await f.events()).filter(e=>e.op==='tap').length,0);
});

test('a fill the phone could not confirm fails like one on a simulator and says what the field holds',async t=>{
 const f=await fixture(t);await f.set({field:'',typeReply:{isError:true,stop_reason:'error',sent:true,text_verified:false,reason:'text_not_verified',submit_sent:false,instruction:'Nothing was submitted.'}});
 const result=await f.call('batch_commands',{commands:[{tool:'fill',arguments:{text:'hello poki'}},{tool:'press_key',arguments:{key:'return'}}]});
 assert.equal(result.isError,true);
 assert.equal((await f.events()).filter(e=>e.op==='key').length,0);
 const summary=summaryOf(result);
 assert.equal(summary.stop_reason,'error');assert.equal(summary.failed_step.tool,'fill');
 assert.match(summary.failed_step.error,/The field holds \\"\\" instead of the requested text/);
 });

test('launch_app on a simulator waits for a readable interface and reports when there is none',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,axEmptyReads:3,label:'Ready'});
 const launched=value(await f.call('launch_app',{bundle_id:'local.fixture'}));
 assert.equal(launched.interface_ready,true);assert.ok(launched.screen.text.includes('Button: Ready'));
 await f.set({simulatorOnly:true,simulatorBooted:true,axEmptyReads:100000});
 const blank=await f.call('launch_app',{bundle_id:'local.fixture'});
 assert.notEqual(blank.isError,true);assert.equal(value(blank).interface_ready,false);
});

test('fill enters plain text exactly when the simulator keyboard is an input method',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Ready',field:'',typed:'hello poki',imeResult:'hellopo ki'});
 const named=value(await f.call('fill',{field:'Name',text:'hello poki'}));
 assert.equal(named.text_verified,true);assert.equal(named.field_value,'hello poki');
 const onlyField=value(await f.call('fill',{text:'hello poki'}));
 assert.equal(onlyField.text_verified,true);
});

test('a fill that could not enter its text stops the batch',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Ready',field:'',typed:'hello poki',imeResult:'hellopo ki',keyboardIgnored:true});
 const result=await f.call('batch_commands',{commands:[{tool:'fill',arguments:{field:'Name',text:'hello poki'}},{tool:'tap_text',arguments:{text:'Ready'}}]});
 assert.equal(result.isError,true);
 const summary=summaryOf(result);
 assert.equal(summary.failed_step.tool,'fill');assert.equal(summary.remaining_steps.length,2);
 assert.equal(touches(await f.events()),1);
});

test('a field that vanishes while typing fails the fill and the send after it never runs',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Send',field:'',typed:'hello poki',imeResult:'hello poki',fieldVanishesOnTyping:true});
 const result=await f.call('batch_commands',{commands:[{tool:'fill',arguments:{field:'Name',text:'hello poki'}},{tool:'tap_text',arguments:{text:'Send'}}]});
 assert.equal(result.isError,true);
 const summary=summaryOf(result);
 assert.equal(summary.failed_step.tool,'fill');assert.equal(summary.remaining_steps.length,2);
 assert.equal(touches(await f.events()),1);
});

test('fill leaves an empty field alone before typing, because backspace can delete what holds it',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Ready',field:'',typed:'hello poki',imeResult:'hello poki',backspaceDeletesEmptyField:true});
 const filled=value(await f.call('fill',{field:'Name',text:'hello poki'}));
 assert.equal(filled.text_verified,true);assert.equal(filled.field_value,'hello poki');
});

test('fill still clears a field that holds text',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Ready',field:'old',typed:'hello poki',imeResult:'hello poki'});
 assert.equal(value(await f.call('fill',{field:'Name',text:'hello poki'})).text_verified,true);
 assert.ok((await f.events()).some(e=>e.op==='hid'&&e.request.events.some(event=>event.payload?.usageCode===42)));
});

test('fill targets the input when another element shares its name, and never an element that takes no text',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Name',field:'',typed:'hello poki',imeResult:'hello poki'});
 const filled=value(await f.call('fill',{field:'Name',text:'hello poki'}));
 assert.equal(filled.text_verified,true);assert.equal(filled.field_value,'hello poki');
 await f.set({label:'Save',field:''});
 const before=typingEvents(await f.events());
 const refused=await f.call('fill',{field:'Save',text:'hello poki'});
 assert.equal(refused.isError,true);
 assert.equal(typingEvents(await f.events()),before);
});

test('fill can still aim at text recognized on a screen accessibility cannot read',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Name',typed:'hello poki',imeResult:'hello poki',axEmptyReads:1000});
 const result=await f.call('fill',{field:'Name',text:'hello poki'});
 assert.ok(!result.isError);
 assert.ok(typingEvents(await f.events())>0);
});

const typingEvents=events=>events.filter(e=>e.op==='hid'&&e.request.events.some(event=>event.messageType==='IndigoKeyboardButtonEvent')).length;

const simulator={simulatorOnly:true,simulatorBooted:true,typed:'hello poki',imeResult:'hello poki'};
test('fill aims again when a list slides the field away, so the row now under the old place keeps its text',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({...simulator,label:'Ready',field:'',list:{slideReads:1,row:'keep me'}});
 const filled=await f.call('fill',{field:'Name',text:'hello poki'});
 assert.ok(!filled.isError,filled.content[0].text);
 const shown=value(await f.call('list_elements'));
 assert.ok(shown.elements.some(e=>e.label==='keep me'&&e.type!=='TextField'));
 assert.ok(shown.elements.some(e=>e.type==='TextField'&&e.value==='hello poki'));
});
test('a tap that lands on another row stops the fill before any text and before the send',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({...simulator,label:'Send',field:'',list:{alwaysHits:true,row:'keep me'}});
 const result=await f.call('batch_commands',{commands:[{tool:'fill',arguments:{field:'Name',text:'hello poki'}},{tool:'tap_text',arguments:{text:'Send'}}]});
 assert.equal(result.isError,true);
 const summary=summaryOf(result);
 assert.equal(summary.failed_step.tool,'fill');assert.match(summary.failed_step.error,/Nothing was typed/);assert.equal(summary.remaining_steps.length,2);
 assert.equal(typingEvents(await f.events()),0);
 assert.ok(value(await f.call('list_elements')).elements.some(e=>e.type==='TextField'&&e.value==='keep me'));
});
test('a field that already has focus takes the text with no touch at all',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({...simulator,label:'Ready',field:'',focused:true});
 const filled=await f.call('fill',{field:'Name',text:'hello poki'});
 assert.ok(!filled.isError,filled.content[0].text);
 assert.equal(touches(await f.events()),0);
});
const fieldValues=f=>f.call('list_elements').then(r=>value(r).elements.filter(e=>e.type==='TextField').map(e=>e.value));
const returns=events=>events.filter(e=>e.op==='hid'&&e.request.events.some(event=>event.payload?.usageCode===40)).length;
const refusedTwins=result=>{assert.equal(result.isError,true);assert.match(result.content[0].text,/Nothing was typed/);assert.match(result.content[0].text,/type_text/);};
for(const name of ['Title','']){
 // Before the rule, the tap scrolled the list, the retry at the old place hit the next field, and the text and Return went there.
 test(`two fields named ${JSON.stringify(name)} holding the same text with no id get no touch, text or Return, wherever fill aims`,{skip:needsSimulator},async t=>{
  const f=await fixture(t);const twins={...simulator,label:'Ready',field:'',otherField:'',focused:false,sameName:name,shiftsOnTap:true};await f.set(twins);
  refusedTwins(await f.call('fill',{x:30,y:50,text:'hello poki',submit:true}));
  const {ref}=value(await f.call('list_elements')).elements.find(e=>e.type==='TextField');
  refusedTwins(await f.call('fill',{ref,text:'hello poki',submit:true}));
  if(name)refusedTwins(await f.call('fill',{field:name,text:'hello poki',submit:true}));
  await f.set({...twins,focused:true});
  refusedTwins(await f.call('fill',{x:30,y:50,text:'hello poki',submit:true}));
  assert.deepEqual(await fieldValues(f),['','']);
  const events=await f.events();assert.equal(touches(events),0);assert.equal(returns(events),0);
 });
 test(`two fields named ${JSON.stringify(name)} holding different text stay apart when the tap moves the list`,{skip:needsSimulator},async t=>{
  const f=await fixture(t);await f.set({...simulator,label:'Ready',field:'draft',otherField:'keep me',focused:false,sameName:name,shiftsOnTap:true});
  const filled=await f.call('fill',{x:30,y:50,text:'hello poki',submit:true});
  assert.ok(!filled.isError,filled.content[0].text);
  assert.deepEqual(await fieldValues(f),['hello poki','keep me']);
  const events=await f.events();assert.equal(touches(events),1);assert.equal(returns(events),1);
 });
 test(`text that lands in another field named ${JSON.stringify(name)} fails the fill and submit never runs`,{skip:needsSimulator},async t=>{
  const f=await fixture(t);await f.set({...simulator,label:'Ready',field:'draft',otherField:'keep me',focused:true,sameName:name,typingGoesToOther:true});
  const astray=await f.call('fill',{x:30,y:50,text:'hello poki',submit:true});
  assert.equal(astray.isError,true);assert.match(astray.content[0].text,/Nothing was submitted/);
  assert.equal(returns(await f.events()),0);
 });
}
test('a same-looking field that appears after the tap gets no text and no Return',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({...simulator,label:'Ready',field:'',focused:false,sameName:'Title',revealsTwinOnTap:true});
 refusedTwins(await f.call('fill',{x:30,y:50,text:'hello poki',submit:true}));
 assert.deepEqual(await fieldValues(f),['','']);
 assert.equal(returns(await f.events()),0);
});
test('text that lands in another field fails the fill and submit never runs',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({...simulator,label:'Ready',field:'',otherField:'',typingGoesToOther:true});
 const result=await f.call('fill',{field:'Name',text:'hello poki',submit:true});
 assert.equal(result.isError,true);assert.match(result.content.at(-1).text+result.content[0].text,/Nothing was submitted/);
 assert.equal((await f.events()).filter(e=>e.op==='hid'&&e.request.events.some(event=>event.payload?.usageCode===40)).length,0);
});

// A phone as measured: the keyboard request drops the soft keyboard and moves the fields, and a touch lands on whatever is at that place then.
const rows=(...list)=>({phone:{keyboard:list.some(r=>r.editing),rows:list},label:'Ready'});
const newRow={id:'o2',placeholder:'标题',value:'',up:70,down:130};
const oldRow={id:'o1',value:'keep me',up:20,down:70};
const phoneInput=events=>events.filter(e=>e.request?.op==='type_text'||e.op==='type_text');
const phoneTaps=events=>events.filter(e=>(e.request?.op??e.op)==='tap');
const held=async f=>Object.fromEntries(value(await f.call('list_elements')).elements.filter(e=>e.object_id).map(e=>[e.object_id,e.value]));
test('a field found by name is refused when another shares its id and text, with no tap on the phone',async t=>{
 const f=await fixture(t);const field=(placeholder,y)=>({role:'TextField',identifier:'row',placeholder,value:'',frame:{x:10,y,width:40,height:20}});
 await f.set({elements:[field('First',40),field('Second',70)]});
 refusedTwins(await f.call('fill',{field:'First',text:'hello poki',submit:true}));
 const events=await f.events();assert.equal(phoneTaps(events).length,0);assert.equal(phoneInput(events).length,0);
});
test('a phone fill on a new row being edited leaves the row above alone, the overwrite this guards against',async t=>{
 const f=await fixture(t);await f.set(rows(oldRow,{...newRow,editing:true}));
 const filled=value(await f.call('fill',{field:'标题',text:'hello poki',submit:true}));
 assert.equal(filled.text_verified,true);
 assert.deepEqual(await held(f),{o1:'keep me',o2:'hello poki'});
 assert.equal(phoneTaps(await f.events()).length,0);
});
test('a phone fill at coordinates with no field there leaves the row being edited alone',async t=>{
 const f=await fixture(t);await f.set(rows({...oldRow,editing:true},newRow));
 const result=await f.call('batch_commands',{commands:[{tool:'fill',arguments:{x:30,y:55,text:'hello poki',submit:true}},{tool:'press_key',arguments:{key:'return'}}]});
 assert.equal(result.isError,true);assert.match(summaryOf(result).failed_step.error,/Nothing was typed/);
 const events=await f.events();assert.equal(phoneInput(events).length,0);assert.equal(phoneTaps(events).length,0);assert.equal(events.filter(e=>(e.request?.op??e.op)==='key').length,0);
 assert.deepEqual(await held(f),{o1:'keep me',o2:'标题'});
});
test('a phone fill by ref follows its field when another row has moved under the old place',async t=>{
 const f=await fixture(t);const up=rows({...oldRow,down:70},{...newRow,editing:true});await f.set(up);
 const {ref}=value(await f.call('list_elements')).elements.find(e=>e.object_id==='o2');
 await f.set({...up,phone:{...up.phone,keyboard:false,rows:[{...oldRow,down:70},newRow]}});
 assert.equal(value(await f.call('fill',{ref,text:'hello poki'})).text_verified,true);
 assert.deepEqual(await held(f),{o1:'keep me',o2:'hello poki'});
});
test('a phone fill taps a field not being edited, then tells native which field it means',async t=>{
 const f=await fixture(t);await f.set(rows(oldRow,newRow));
 assert.equal(value(await f.call('fill',{field:'标题',text:'hello poki'})).text_verified,true);
 assert.deepEqual(await held(f),{o1:'keep me',o2:'hello poki'});
 assert.equal(phoneTaps(await f.events()).length,1);
});
test('a phone tap that gives the edit to another row stops the batch with no text sent',async t=>{
 const f=await fixture(t);await f.set({...rows(oldRow,newRow),phone:{...rows(oldRow,newRow).phone,tapLandsOn:'o1'}});
 const result=await f.call('batch_commands',{commands:[{tool:'fill',arguments:{field:'标题',text:'hello poki'}},{tool:'tap_text',arguments:{text:'Ready'}}]});
 const summary=summaryOf(result);
 assert.equal(summary.failed_step.tool,'fill');assert.match(summary.failed_step.error,/Nothing was typed/);
 assert.deepEqual(await held(f),{o1:'keep me',o2:'标题'});
});
test('a phone field that never starts editing gets two taps and no text',async t=>{
 const f=await fixture(t);await f.set({...rows(newRow),phone:{...rows(newRow).phone,tapsIgnored:true}});
 const result=await f.call('fill',{field:'标题',text:'hello poki',submit:true});
 assert.equal(result.isError,true);assert.match(result.content[0].text,/Nothing was typed/);
 const events=await f.events();
 assert.equal(phoneTaps(events).length,2);assert.equal(phoneInput(events).length,0);
});
test('a phone field native refuses stops the batch before the send',async t=>{
 const f=await fixture(t);await f.set({...rows({...newRow,editing:true}),typeReply:{isError:true,outcome:'not_sent',stop_reason:'error',reason:'target_changed',sent:false,text_verified:false,submit_sent:false,instruction:'The requested field changed before typing. Nothing was typed.'}});
 const result=await f.call('batch_commands',{commands:[{tool:'fill',arguments:{field:'标题',text:'hello poki'}},{tool:'tap_text',arguments:{text:'Ready'}}]});
 const summary=summaryOf(result);
 assert.equal(summary.stop_reason,'error');assert.equal(summary.failed_step.tool,'fill');assert.equal(summary.remaining_steps.length,2);
});

// The whole of locate, not a copy of it, through every tool that sends input to what it finds.
const locating={tap_text:{text:'First'},fill:{field:'Name',text:'hello poki'},handle_alert:{button:'First'}};
const inputSent=events=>events.some(e=>['tap','type_text'].includes(e.request?.op??e.op));
const gone=pid=>processGone(pid);
for(const [tool,args] of Object.entries(locating)){
 test(`${tool} sends nothing when its read outlasts the five seconds, and that read is stopped`,async t=>{
  const f=await fixture(t);await f.set({field:'',axDelayMs:60000});
  const begun=performance.now();
  const result=await f.call(tool,args);
  assert.equal(result.isError,true);assert.equal(inputSent(await f.events()),false);
  const reads=(await f.events()).filter(e=>e.tool==='poki-native'&&e.pid);
  assert.ok((await Promise.all(reads.map(e=>gone(e.pid)))).every(Boolean));
  assert.ok(performance.now()-begun<20000);
 });
 test(`${tool} sends nothing to a target that never holds its place`,async t=>{
  const f=await fixture(t);await f.set({field:'',moving:1});
  // Input just went out, so one read of the target proves nothing.
  const result=await f.call('batch_commands',{commands:[{tool:'press_key',arguments:{key:'a'}},{tool,arguments:args}]});
  assert.equal(result.isError,true);
  assert.match(summaryOf(result).failed_step.error,/kept moving/);
  assert.equal(inputSent(await f.events()),false);
 });
}
test('a recognition that began inside the five seconds still finishes and is used',async t=>{
 const f=await fixture(t);await f.set({axEmpty:true,ocrDelayMs:6000});
 const started=Date.now();
 const result=await f.call('tap_text',{text:'First'});
 const elapsed=Date.now()-started;
 // Nothing new may start after five seconds, but this recognition started at once on a screen
 // accessibility could not read, so its answer counts even though it arrives later. Six seconds
 // rather than upstream's eight keeps the bound here meaningful: the resident OCR is not aborted
 // by the readback deadline, so this call also recognizes the final screen once.
 assert.ok(!result.isError);
 assert.ok(elapsed>=5500,'the recognition was not allowed to finish: '+elapsed+'ms');
 assert.ok(elapsed<18000,'the search outlasted its window: '+elapsed+'ms');
 assert.equal(inputSent(await f.events()),true);
});

test('no new look starts after the five seconds, so a late empty read never reaches OCR',async t=>{
 const f=await fixture(t);await f.set({axDelayMs:6000,axEmpty:true});
 const result=await f.call('tap_text',{text:'First'});
 assert.equal(result.isError,true);
 const events=await f.events();
 assert.equal(inputSent(events),false);
 assert.equal(events.filter(e=>e.tool==='ocr').length,0);
});

test('fill taps again when the first tap does not give the field focus',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Ready',field:'',typed:'hello poki',imeResult:'hellopo ki',tapsIgnored:1});
 const filled=value(await f.call('fill',{field:'Name',text:'hello poki'}));
 assert.equal(filled.text_verified,true);
 assert.equal(touches(await f.events()),2);
});

test('a field that never takes focus fails the fill and stops the batch',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Ready',field:'',typed:'hello poki',imeResult:'hellopo ki',tapsIgnored:1000});
 const result=await f.call('batch_commands',{commands:[{tool:'fill',arguments:{field:'Name',text:'hello poki'}},{tool:'tap_text',arguments:{text:'Ready'}}]});
 assert.equal(result.isError,true);
 const summary=summaryOf(result);
 assert.equal(summary.failed_step.tool,'fill');assert.equal(summary.remaining_steps.length,2);
});

test('a lost tap never types over the field that still has focus',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Ready',field:'',otherField:'keep me',typed:'hello poki',imeResult:'hellopo ki',tapsIgnored:1000});
 const result=await f.call('fill',{field:'Name',text:'hello poki'});
 assert.equal(result.isError,true);assert.match(result.content[0].text,/Nothing was typed/);
 assert.equal(typingEvents(await f.events()),0);
});

const inputConnections=events=>events.filter(e=>e.tool==='simulator'&&e.args[0]==='--hid-session').length;

test('input to a simulator stays on one connection while it keeps coming',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Ready',toggle:true});
 await f.call('batch_commands',{commands:[{tool:'tap_text',arguments:{text:'Ready'}},{tool:'tap_text',arguments:{text:'Ready'}}]});
 await f.call('tap_text',{text:'Ready'});
 const events=await f.events();
 assert.equal(touches(events),3);assert.equal(inputConnections(events),1);
});

test('a connection the simulator dropped while idle is replaced and the tap still lands',{skip:needsSimulator},async t=>{
 const f=await fixture(t),ready={simulatorOnly:true,simulatorBooted:true,label:'Ready'};await f.set(ready);
 await f.call('tap_text',{text:'Ready'});
 await f.set({...ready,inputExit:75});
 const result=await f.call('tap_text',{text:'Ready'});
 assert.equal(result.isError,undefined);
 const events=await f.events();
 assert.equal(touches(events),2);assert.equal(inputConnections(events),2);
});

test('a connection lost during a send reports an unknown outcome and sends nothing again',{skip:needsSimulator},async t=>{
 const f=await fixture(t),ready={simulatorOnly:true,simulatorBooted:true,label:'Ready'};await f.set(ready);
 await f.call('tap_text',{text:'Ready'});
 await f.set({...ready,inputExit:1});
 const result=value(await f.call('tap_text',{text:'Ready'}));
 assert.equal(result.outcome,'unknown');assert.match(result.error,/may already have been delivered/);
 assert.equal(inputConnections(await f.events()),1);
});

test('typing selects the keyboard again when it changed under a live connection',{skip:needsSimulator},async t=>{
 const f=await fixture(t),ready={simulatorOnly:true,simulatorBooted:true,label:'Ready',field:'',typed:'hello poki',imeResult:'hellopo ki'};await f.set(ready);
 await f.call('tap_text',{text:'Ready'});
 await f.set({...ready,keyboard:'zh_Hans-Pinyin'});
 const filled=value(await f.call('fill',{field:'Name',text:'hello poki'}));
 assert.equal(filled.text_verified,true);
 assert.equal(inputConnections(await f.events()),1);
});

test('an app launches on the en_US keyboard even with a connection already open',{skip:needsSimulator},async t=>{
 const f=await fixture(t),ready={simulatorOnly:true,simulatorBooted:true,label:'Ready'};await f.set(ready);
 await f.call('tap_text',{text:'Ready'});
 const earlier=(await f.events()).length;
 await f.call('launch_app',{bundle_id:'local.fixture'});
 const events=(await f.events()).slice(earlier),at=word=>events.findIndex(e=>e.tool==='xcrun'&&e.args.includes(word));
 assert.ok(at('keyboard')>=0&&at('keyboard')<at('launch'));
});

test('a large max_scrolls is not refused',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Ready'});
 const found=value(await f.call('scroll_to',{text:'Ready',max_scrolls:100}));
 assert.equal(found.found,true);
});

test('a tap after another input waits until the app can take touches',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({simulatorOnly:true,simulatorBooted:true,label:'Ready',toggle:true,busyAfterTouchMs:500});
 const result=await f.call('batch_commands',{commands:[{tool:'tap_text',arguments:{text:'Ready'}},{tool:'tap_text',arguments:{text:'Ready'}}]});
 assert.equal(result.isError,undefined);
 assert.equal((await f.events()).filter(e=>e.op==='touch_ignored').length,0);
});

const twoSimulators={simulatorOnly:true,simulatorBooted:true,secondSimulator:true,labels:{'fixture-sim':'On first','fixture-sim-2':'On second'}};
const replyOf=block=>value({content:[block]});

test('a device named in a batch step holds for that step, whatever is selected',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set(twoSimulators);
 const named={tool:'get_device_info',arguments:{device:'fixture-sim-2'}};
 const fresh=await f.call('batch_commands',{commands:[named]});
 assert.notEqual(fresh.isError,true,JSON.stringify(fresh.content));
 assert.equal(replyOf(fresh.content[1]).id,'fixture-sim-2');
 await f.call('select_device',{device:'fixture-sim'});
 const mixed=await f.call('batch_commands',{commands:[named,{tool:'get_device_info'}]});
 assert.deepEqual([mixed.content[1],mixed.content[3]].map(block=>replyOf(block).id),['fixture-sim-2','fixture-sim']);
 await f.call('batch_commands',{commands:[{tool:'tap',arguments:{x:10,y:10,device:'fixture-sim-2'}}]});
 assert.deepEqual((await f.events()).filter(e=>e.op==='hid').map(e=>e.device),['fixture-sim-2']);
});

test('the screen a batch ends with belongs to the device its last step used',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set({...twoSimulators,toggle:true});
 await f.call('select_device',{device:'fixture-sim'});
 const tapOn=device=>({tool:'tap',arguments:{x:10,y:10,...(device?{device}:{})}});
 const second=tapOn('fixture-sim-2'),selected=tapOn();
 for(const [commands,shown] of [[[second],'On second'],[[selected,second],'On second'],[[second,selected],'On first']])
  assert.deepEqual(summaryOf(await f.call('batch_commands',{commands})).screen.text,[`Button: ${shown}`]);
 await f.set({...twoSimulators,labels:{'fixture-sim':'允许粘贴','fixture-sim-2':'On second'}});
 assert.equal(summaryOf(await f.call('batch_commands',{commands:[second]})).stop_reason,null);
 await f.set({...twoSimulators,labels:{'fixture-sim':'On first','fixture-sim-2':'允许粘贴'}});
 const summary=summaryOf(await f.call('batch_commands',{commands:[second]}));
 assert.equal(summary.stop_reason,null);assert.deepEqual(summary.screen.prompt,{kind:'paste'});
});

test('a target read on one device is never tapped on another',{skip:needsSimulator},async t=>{
 const f=await fixture(t);await f.set(twoSimulators);
 await f.call('select_device',{device:'fixture-sim'});
 const launch={tool:'launch_app',arguments:{bundle_id:'local.fixture'}};
 const missed=await f.call('batch_commands',{commands:[launch,{tool:'tap_text',arguments:{text:'On first',device:'fixture-sim-2'}}]});
 assert.equal(missed.isError,true);
 const summary=summaryOf(missed);
 assert.equal(summary.failed_step.step,2);assert.match(summary.failed_step.error,/No visible element matches "On first"/);
 assert.equal(touches(await f.events()),0);
 const found=await f.call('batch_commands',{commands:[launch,{tool:'tap_text',arguments:{text:'On second',device:'fixture-sim-2'}}]});
 assert.equal(found.isError,undefined);
 assert.deepEqual((await f.events()).filter(e=>e.op==='hid').map(e=>e.device),['fixture-sim-2']);
});

test('application names reuse a per-device directory across sessions and refresh after mutations', async t => {
 const f=await fixture(t,{approvalMode:'allow'}), second=await f.connect();
 const catalog=[{name:'携程旅行',bundle_id:'ctrip.com',system:false},{name:'Travel',bundle_id:'local.travel',system:false},{name:'Travel Pro',bundle_id:'local.pro',system:false},{name:'Settings',bundle_id:'com.apple.Preferences',system:true,aliases:['设置']},{name:'WeChat',bundle_id:'com.tencent.xin',system:false,aliases:['微信']}];
 const call=(client,name,args={})=>client.callTool({name,arguments:{device:'fixture-phone',...args}});
 await f.set({twoPhones:true,apps:catalog});
 const listed=await call(f.a,'list_apps');assert.equal(value(listed).apps.length,4);
 for(const [client,query,bundle] of [[second,'携程','ctrip.com'],[f.a,'Travel','local.travel'],[second,'设置','com.apple.Preferences'],[second,'微信','com.tencent.xin']]){
  const launched=await call(client,'launch_app',{name:query});
  assert.ok(!launched.isError,JSON.stringify(launched));assert.equal(value(launched).bundle_id,bundle);
  assert.equal(launched._meta.app_lookup.cache_hit,true);
  assert.ok(launched._meta.timing.stages.some(s=>s.phase==='app_lookup'));
 }
 assert.equal((await f.events()).filter(e=>e.op==='list_apps').length,1);
 const isolated=await call(second,'launch_app',{device:'fixture-phone-2',name:'携程'});
 assert.equal(isolated._meta.app_lookup.cache_hit,false);
 assert.equal((await f.events()).filter(e=>e.op==='list_apps').length,2);
 for(const query of ['Trav','Missing']){
  const before=(await f.events()).filter(e=>e.op==='launch_app').length;
  const rejected=await call(second,'launch_app',{name:query});
  assert.equal(rejected.isError,true);assert.equal(value(rejected).outcome,'not_sent');
  assert.equal((await f.events()).filter(e=>e.op==='launch_app').length,before);
 }
 const beforeDirect=(await f.events()).filter(e=>e.op==='list_apps').length;
 assert.ok(!(await call(f.a,'launch_app',{bundle_id:'ctrip.com'})).isError);
 assert.equal((await f.events()).filter(e=>e.op==='list_apps').length,beforeDirect);
 const app=f.dir+'/InstallFixture.app';await mkdir(app);await writeFile(app+'/Info.plist','<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.installfixture</string></dict></plist>');
 for(const unknown of [false,true]){
  await f.set({twoPhones:true,...(unknown?{installUnknown:true}:{})});
  const installed=await call(f.a,'install_app',{path:app});assert.equal(Boolean(installed.isError),unknown);
  await f.set({twoPhones:true,apps:catalog});
  const refreshed=await call(second,'launch_app',{name:'携程'});
  assert.ok(!refreshed.isError,JSON.stringify(refreshed));assert.equal(refreshed._meta.app_lookup.cache_hit,false);
 }
});

test('verify:false omits action verification and batches observe once after all inputs', async t => {
 const f=await fixture(t);
 for(const [tool,args,inputOp,locationReads] of [
  ['tap',{x:10,y:10},'tap',0],
  ['swipe',{from_x:10,from_y:10,to_x:20,to_y:20},'drag',0],
  ['scroll',{direction:'down'},'drag',0],
  ['tap_text',{text:'First'},'tap',1],
 ]) {
  const before=(await f.events()).length;
  const result=await f.call(tool,{...args,verify:false}),receipt=value(result);
  assert.notEqual(result.isError,true,JSON.stringify(result));
  assert.equal(receipt.sent,true,tool);
  assert.equal(receipt.verified,false,tool);
  assert.equal(receipt.screen,undefined,tool);
  assert.equal(receipt.screen_changed,undefined,tool);
  const events=(await f.events()).slice(before);
  assert.equal(events.filter(event=>event.op===inputOp).length,1,tool);
  assert.equal(events.filter(event=>event.op==='ax_tree').length,locationReads,tool);
  assert.equal(events.filter(event=>event.tool==='ocr').length,0,tool);
 }
 const before=(await f.events()).length;
 const result=await f.call('batch_commands',{verify:false,commands:[
  {tool:'tap',arguments:{x:10,y:10}},
  {tool:'tap',arguments:{x:10,y:10}},
 ]});
 assert.notEqual(result.isError,true,JSON.stringify(result));
 const summary=summaryOf(result);
 assert.equal(summary.completed_steps,2);
 assert.equal(summary.stop_reason,null);
 assert.equal(summary.verified,false);
 assert.ok(summary.screen.text.includes('Button: First'));
 const operations=(await f.events()).slice(before).filter(event=>event.op).map(event=>event.op);
 assert.deepEqual(operations,['tap','tap','ax_tree']);
 await f.set({inputError:true});
 const failedBefore=(await f.events()).length;
 const failed=await f.call('batch_commands',{verify:false,stop_on_error:false,commands:[
  {tool:'tap',arguments:{x:10,y:10}},
  {tool:'tap',arguments:{x:10,y:10}},
 ]});
 assert.equal(failed.isError,true);
 assert.equal(summaryOf(failed).stop_reason,'unknown');
 assert.equal((await f.events()).slice(failedBefore).filter(event=>event.op==='tap').length,1,'Unknown input must not be replayed or followed by another input');
 await f.set({});
 const overridden=await f.call('batch_commands',{verify:false,commands:[
  {tool:'tap',arguments:{x:10,y:10,verify:true}},
  {tool:'tap',arguments:{x:10,y:10}},
 ]});
 assert.equal(summaryOf(overridden).stop_reason,'no_change');
 assert.equal(summaryOf(overridden).completed_steps,1);
});
