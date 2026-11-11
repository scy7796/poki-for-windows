import http from 'node:http';
import { EventEmitter, once } from 'node:events';

export async function makeTelegram() {
  const fixture = new EventEmitter();
  Object.assign(fixture, { token: '123456:local_test_token', updates: [], messages: [], edits: [], photos: [], requests: [], failures: [] });
  let sequence = 0;
  fixture.add = (text, user = 101, extra = {}) => {
    const update = { update_id: ++sequence, message: { message_id: sequence, text,
      from: { id: user, is_bot: false }, chat: { id: user, type: 'private' }, ...extra } };
    fixture.updates.push(update);
    return update.update_id;
  };
  const server = http.createServer(async (req, res) => {
    const send = (code, value) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    if (!req.url.startsWith(`/bot${fixture.token}/`) || req.method !== 'POST') { send(401, { ok: false, error_code: 401 }); return; }
    const method = req.url.split('/').at(-1);
    let raw = ''; for await (const chunk of req) raw += chunk;
    // sendPhoto posts multipart, everything else posts JSON. Only the two text fields of the photo
    // body matter here, plus whether a file part arrived at all.
    const multipart = String(req.headers['content-type'] ?? '').startsWith('multipart/form-data');
    const body = multipart
      ? {
          chat_id: raw.match(/name="chat_id"\r?\n\r?\n([^\r\n]+)/)?.[1],
          caption: raw.match(/name="caption"\r?\n\r?\n([\s\S]*?)\r?\n--/)?.[1],
          photo: /name="photo"; filename="screen\.(png|jpg)"/.test(raw),
        }
      : JSON.parse(raw);
    fixture.requests.push({ method, body });
    if (fixture.failures[0]?.method === method) {
      const failure = fixture.failures.shift();
      if (failure.destroy) { res.destroy(); return; }
      if (failure.raw !== undefined) { res.writeHead(failure.code ?? 200, { 'content-type': 'application/json' }).end(failure.raw); return; }
      send(failure.code, { ok: false, error_code: failure.code, description: failure.description ?? fixture.token,
        parameters: failure.parameters }); return;
    }
    let result;
    if (method === 'getMe') result = { id: 123456, is_bot: true, first_name: 'Local Test' };
    else if (method === 'getWebhookInfo') result = { url: fixture.webhook ?? '' };
    else if (method === 'getUpdates') {
      if (body.offset === -1) fixture.updates = fixture.updates.slice(-1);
      else fixture.updates = fixture.updates.filter(update => update.update_id >= body.offset);
      result = fixture.updates.slice(0, body.limit);
    } else if (method === 'sendMessage') {
      result = { message_id: fixture.messages.length + 1, chat: { id: Number(body.chat_id), type: 'private' }, text: body.text };
      fixture.messages.push(result);
    } else if (method === 'sendPhoto') {
      result = { message_id: 1000 + fixture.photos.length, chat: { id: Number(body.chat_id), type: 'private' }, caption: body.caption };
      fixture.photos.push(result);
    } else if (method === 'editMessageText') {
      const message = fixture.messages.find(item => item.message_id === body.message_id && item.chat.id === Number(body.chat_id));
      if (!message) { send(400, { ok: false, error_code: 400, description: 'Bad Request: message to edit not found' }); return; }
      message.text = body.text;
      fixture.edits.push({ ...body });
      result = message;
    } else { send(404, { ok: false, error_code: 404 }); return; }
    send(200, { ok: true, result });
    fixture.emit('request', method, body);
    if (method === 'sendMessage') fixture.emit('reply', body.text, String(body.chat_id));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  fixture.url = `http://127.0.0.1:${server.address().port}`;
  fixture.close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return fixture;
}
