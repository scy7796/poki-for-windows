import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture.mjs';

test('POKI_MCP_CALL_LOG records each call by tool, time and verdict, and nothing it was given', { timeout: 30000 }, async t => {
 const f=await fixture(t,{extraEnv:dir=>({POKI_MCP_CALL_LOG:join(dir,'calls.jsonl')})});
 await f.set({label:'Same'});
 await f.call('tap',{x:10,y:10});
 await f.call('tap_text',{text:'Nowhere to be found'});
 const lines=(await readFile(join(f.dir,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(lines.map(l=>[l.tool,l.verdict,l.error]),[['tap','unchanged',false],['tap_text',null,true]]);
 assert.ok(lines.every(l=>Number.isInteger(l.ms)&&/^[0-9a-f]{12}$/.test(l.session)&&!Number.isNaN(Date.parse(l.at))));
 assert.doesNotMatch(JSON.stringify(lines),/Nowhere/);
});
