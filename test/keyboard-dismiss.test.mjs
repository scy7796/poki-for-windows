import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,value} from './fixture.mjs';

const letter={role:'Key',label:'q',frame:{x:5,y:140,width:10,height:20}};
const hide={role:'Key',label:'Hide keyboard',frame:{x:70,y:170,width:20,height:20}};

test('hide_keyboard uses the visible keyboard hide key rather than an unsupported hardware toggle',async t=>{
 const f=await fixture(t);
 await f.set({elements:[letter,hide],afterInput:{elements:[]}});
 assert.equal(value(await f.call('hide_keyboard')).hidden,true);
 const sent=(await f.events()).filter(e=>['tap','button'].includes(e.op));
 assert.equal(sent.length,1);
 assert.equal(sent[0].op,'tap');
 assert.equal(sent[0].request.x,Math.round(80/99*65535));
 assert.equal(sent[0].request.y,Math.round(180/199*65535));
});

for(const [name,controls] of [
 ['an ordinary App button',[{...hide,role:'Button'}]],
 ['an offscreen key',[{...hide,frame:{...hide.frame,y:210}}]],
 ['ambiguous hide keys',[hide,{...hide,frame:{...hide.frame,x:45}}]],
])test(`hide_keyboard never taps ${name}`,async t=>{
 const f=await fixture(t);await f.set({elements:[letter,...controls],afterInput:{elements:[]}});
 assert.equal(value(await f.call('hide_keyboard')).hidden,true);
 const sent=(await f.events()).filter(e=>['tap','button'].includes(e.op));
 assert.deepEqual(sent.map(e=>e.op),['button']);
 assert.equal(sent[0].request.button,'keyboard');
});

test('a hide key is not proof the keyboard has gone after tapping it',async t=>{
 const f=await fixture(t);await f.set({elements:[letter,hide]});
 const r=await f.call('hide_keyboard');assert.equal(r.isError,true);assert.match(r.content[0].text,/still visible/);
 assert.equal((await f.events()).filter(e=>e.op==='tap').length,1);
 assert.equal((await f.events()).filter(e=>e.op==='button').length,0,'Never toggle or replay after a hide tap with no confirmed effect');
});


test('a failed hide-key input stops without a second action',async t=>{
 const f=await fixture(t);await f.set({elements:[letter,hide],inputReply:{isError:true,outcome:'unknown',sent:false,instruction:'Input may have been delivered; inspect before retrying.'}});
 const r=await f.call('hide_keyboard');assert.equal(r.isError,true);
 assert.match(r.content[0].text,/unknown/);
 assert.deepEqual((await f.events()).filter(e=>['tap','button'].includes(e.op)).map(e=>e.op),['tap']);
});
