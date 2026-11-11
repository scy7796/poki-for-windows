import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelegramSource } from '../telegram-source.mjs';
import { makeTelegram } from './fixtures/telegram.mjs';

async function setup(t) {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'poki-telegram-test-'));
  const api = await makeTelegram();
  const before = { ...process.env };
  process.env.TELEGRAM_API_URL = api.url;
  process.env.TELEGRAM_BOT_TOKEN = api.token;
  t.after(async () => {
    for (const key of ['TELEGRAM_API_URL', 'TELEGRAM_BOT_TOKEN']) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
    await api.close(); await rm(stateDirectory, { recursive: true, force: true });
  });
  const options = { allowedUsers: ['101', 202], stateDirectory };
  return { api, options, source: new TelegramSource(options) };
}

test('Telegram authorizes private users before dispatch and preserves acknowledged offsets across restart', async t => {
  const { api, source, options } = await setup(t);
  api.add('History');
  await source.open();
  const first = api.add('First task');
  api.add('Unauthorized task', 999);
  api.add('Group task', 101, { chat: { id: -55, type: 'group' } });
  api.add('Spoofed chat', 101, { chat: { id: 202, type: 'private' } });
  api.add('Bot loop', 101, { from: { id: 101, is_bot: true } });
  const second = api.add('Second task', 202);
  const seen = [];
  for await (const message of source.read()) {
    seen.push(message);
    await source.replyTo(message).send(`Received ${message.text}`);
    await source.acknowledge(message.id);
  }
  assert.deepEqual(seen, [
    { id: first, text: 'First task', conversation: '101' },
    { id: second, text: 'Second task', conversation: '202' },
  ]);
  assert.deepEqual(api.messages.map(message => [message.chat.id, message.text]), [[101, 'Received First task'], [202, 'Received Second task']]);
  const restarted = new TelegramSource(options);
  await restarted.open();
  assert.deepEqual(await Array.fromAsync(restarted.read()), []);
  assert.throws(() => new TelegramSource({ ...options, allowedUsers: [] }), /allowedUsers/);
  assert.throws(() => source.replyTo({ conversation: '999' }), /not configured/);
  api.webhook = 'https://example.invalid/hook';
  await assert.rejects(restarted.check(), /active webhook/);
  assert.equal(api.requests.some(request => request.method === 'deleteWebhook'), false);
});

test('Telegram preserves long text, retries only the failed chunk and edits per-task progress', async t => {
  const { api, source } = await setup(t);
  await source.open();
  const reply = source.replyTo({ conversation: '101' });
  const other = source.replyTo({ conversation: '202' });
  const long = '中'.repeat(4095) + '😀' + ' result\n'.repeat(800);
  let injected = false;
  api.on('reply', () => {
    if (!injected) { injected = true; api.failures.push({ method: 'sendMessage', code: 429, parameters: { retry_after: 0 } }); }
  });
  await reply.send(long);
  assert.equal(api.messages.map(message => message.text).join(''), long);
  assert.ok(api.messages.every(message => message.text.length <= 4096 && message.text.isWellFormed()));
  const prior = api.messages.length;
  await reply.send('Planning', { kind: 'progress', taskId: 'a' });
  await other.send('Other task', { kind: 'progress', taskId: 'b' });
  await reply.send('Reading', { kind: 'progress', taskId: 'a' });
  assert.equal(api.messages.length, prior + 2);
  assert.equal(api.messages[prior].text, 'Reading');
  assert.equal(api.messages[prior + 1].text, 'Other task');
  assert.equal(api.edits.length, 1);
  api.failures.push({ method: 'editMessageText', code: 400, description: 'Bad Request: message is not modified' });
  await reply.send('Reading', { kind: 'progress', taskId: 'a' });
  assert.equal(api.messages.length, prior + 2);
  api.failures.push({ method: 'editMessageText', code: 400, description: 'Bad Request: message to edit not found' });
  await reply.send('Continue', { kind: 'progress', taskId: 'a' });
  assert.equal(api.messages.at(-1).text, 'Continue');
  await reply.send('Reply accept, then done.', { kind: 'need', taskId: 'a' });
  await reply.send('Continuing', { kind: 'progress', taskId: 'a' });
  assert.ok(api.messages.some(message => message.text === 'Reply accept, then done.'));
  await reply.send('Completed', { kind: 'final', taskId: 'a' });
  await reply.send('New task', { kind: 'progress', taskId: 'c' });
  assert.ok(api.messages.some(message => message.text === 'Completed'));
  const delivered = api.messages.length;
  api.failures.push({ method: 'sendMessage', code: 401 });
  await assert.rejects(reply.send('Cannot send'), error => /401/.test(error.message) && !error.message.includes(api.token));
  assert.equal(api.messages.length, delivered);
  api.failures.push(...Array.from({ length: 3 }, () => ({ method: 'sendMessage', code: 429, parameters: { retry_after: 0 } })));
  await assert.rejects(reply.send('Retries exhausted'), /429/);
  assert.equal(api.failures.length, 0);
  assert.equal(api.messages.length, delivered);
});

test('Telegram uploads at most one photo per reply and only resends text on a rejection', async t => {
  const { api, options } = await setup(t);
  const image = { data: Buffer.from('not-a-real-png').toString('base64'), mimeType: 'image/png' };
  const methods = () => api.requests.map(request => request.method);

  const quiet = new TelegramSource(options);
  await quiet.replyTo({ conversation: '101' }).send('done', { kind: 'final', image });
  assert.deepEqual(methods(), ['sendMessage']);

  api.requests.length = 0;
  const loud = new TelegramSource({ ...options, photos: true });
  const reply = loud.replyTo({ conversation: '101' });
  await reply.send('done', { kind: 'final', image });
  assert.deepEqual(methods(), ['sendPhoto']);
  assert.equal(api.requests[0].body.photo, true);
  assert.equal(api.requests[0].body.caption, 'done');

  // A definite rejection: Telegram answered and said no, so text still goes out.
  api.requests.length = 0;
  api.failures.push({ method: 'sendPhoto', code: 400, description: 'Bad Request: photo is too big' });
  const before = api.messages.length;
  await reply.send('done', { kind: 'final', image });
  assert.deepEqual(methods(), ['sendPhoto', 'sendMessage']);
  assert.equal(api.messages.length, before + 1);

  // A 200 whose body cannot be read may mean the photo arrived: nothing is resent.
  api.requests.length = 0;
  api.failures.push({ method: 'sendPhoto', code: 200, raw: 'not json' });
  const unreadable = api.messages.length;
  await reply.send('done', { kind: 'final', image });
  assert.deepEqual(methods(), ['sendPhoto']);
  assert.equal(api.messages.length, unreadable);

  // A dropped connection is the same unknown: no second delivery of the same words.
  api.requests.length = 0;
  api.failures.push({ method: 'sendPhoto', destroy: true });
  await reply.send('done', { kind: 'final', image });
  assert.deepEqual(methods(), ['sendPhoto']);
  assert.equal(api.messages.length, unreadable);

  // A gateway error with an unreadable body is the same unknown: a 504 is sent after the upload
  // was accepted, so the text must not follow it.
  api.requests.length = 0;
  api.failures.push({ method: 'sendPhoto', code: 504, raw: '<html>gateway timeout</html>' });
  await reply.send('done', { kind: 'final', image });
  assert.deepEqual(methods(), ['sendPhoto']);
  assert.equal(api.messages.length, unreadable);

  api.requests.length = 0;
  api.failures.push({ method: 'sendPhoto', code: 502, raw: '' });
  await reply.send('done', { kind: 'final', image });
  assert.deepEqual(methods(), ['sendPhoto']);

  // A 4xx with an unreadable body is a rejection - a proxy's 413 for a photo that is too large -
  // so the reply is still delivered as text.
  api.requests.length = 0;
  api.failures.push({ method: 'sendPhoto', code: 413, raw: 'Payload Too Large' });
  await reply.send('done', { kind: 'final', image });
  assert.deepEqual(methods(), ['sendPhoto', 'sendMessage']);
  const textDelivered = api.messages.length;
  assert.equal(textDelivered, unreadable + 1);

  // A reply too long for a caption sends the text first, then one captionless photo.
  api.requests.length = 0;
  const long = 'x'.repeat(1500);
  await reply.send(long, { kind: 'final', image });
  assert.deepEqual(methods(), ['sendMessage', 'sendPhoto']);
  assert.equal(api.requests.at(-1).body.caption, undefined);
  assert.equal(api.messages.length, textDelivered + 1);
});
