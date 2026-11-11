import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, value } from './fixture.mjs';

test('consecutive local MCP observations retain the native helper process', async t => {
  const f = await fixture(t, { beforeStart: async dir => {
    await writeFile(join(dir, 'build/poki-native'), `#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { writeFileSync, readFileSync, appendFileSync } from 'node:fs';
const response = request => {
  appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({op:request.op,pid:process.pid})+'\\n');
  const state = JSON.parse(readFileSync(process.env.FIXTURE_STATE));
  if (state.crash) { writeFileSync(process.env.FIXTURE_STATE, '{}'); process.exit(1); }
  if (request.op !== 'ax_tree') throw new Error('Unexpected fixture operation');
  return {foreground_app:{pid:process.pid,bundle_id:'test.native-session'}};
};
if (process.argv[2] === '--udid') {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  console.log(JSON.stringify(response(JSON.parse(input))));
} else if (process.argv[2] === '--local-server') {
  writeFileSync(process.env.FIXTURE_STATE + '.native-pid', String(process.pid));
  const server = createServer(socket => {
    socket.write(JSON.stringify({pid:process.pid})+'\\n');
    createInterface({input:socket}).once('line', line => {
      socket.end(JSON.stringify(response(JSON.parse(line)))+'\\n');
    });
  });
  server.listen(process.argv[4], () => console.log(JSON.stringify({ready:true})));
} else throw new Error('Unexpected native helper arguments');
`, { mode: 0o755 });
  }});
  t.after(async () => {
    const pid = Number(await readFile(join(f.dir, 'fixture.json.native-pid'), 'utf8').catch(() => ''));
    if (pid > 1) {
      try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  });
  const first = await f.call('get_foreground_app', { device: 'fixture-phone' });
  const second = await f.call('get_foreground_app', { device: 'fixture-phone' });
  assert.notEqual(first.isError, true, JSON.stringify(first));
  assert.notEqual(second.isError, true, JSON.stringify(second));
  assert.equal(value(first).bundle_id, 'test.native-session');
  assert.equal(value(second).bundle_id, 'test.native-session');
  t.diagnostic(`native fixture process IDs: ${value(first).pid}, ${value(second).pid}`);
  assert.equal(value(second).pid, value(first).pid, 'Two local requests must reuse one native process');
  await f.set({ crash: true });
  const interrupted = await f.call('get_foreground_app', { device: 'fixture-phone' });
  assert.equal(interrupted.isError, true, 'The failed request must not be replayed');
  assert.equal((await f.events()).filter(event => event.op === 'ax_tree').length, 3);
  const recovered = await f.call('get_foreground_app', { device: 'fixture-phone' });
  assert.notEqual(recovered.isError, true, JSON.stringify(recovered));
  assert.notEqual(value(recovered).pid, value(first).pid);
  await f.daemon.stop();
  assert.throws(() => process.kill(value(recovered).pid, 0), { code: 'ESRCH' });
});

test('a local native helper that exits before ready reports its exit status and stderr', async t => {
  const f = await fixture(t, { beforeStart: async dir => {
    await writeFile(join(dir, 'build/poki-native'), `#!/usr/bin/env node
console.error('earlier setup line');
console.error('fixture helper cannot bind its socket');
process.exit(3);
`, { mode: 0o755 });
  }});
  const result = await f.call('get_foreground_app', { device: 'fixture-phone' });
  const message = result.content.find(c => c.type === 'text').text;
  assert.equal(result.isError, true, message);
  assert.match(message, /stopped before becoming ready/);
  assert.match(message, /exit code 3/);
  assert.match(message, /fixture helper cannot bind its socket/);
});
