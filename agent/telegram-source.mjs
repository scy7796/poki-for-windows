// Adapted from NousResearch/hermes-agent gateway/platforms/telegram.py and base.py (MIT).
// See SOURCES.md and licenses/hermes-MIT.txt for the supplied source snapshot and adaptations.
import { setTimeout } from 'node:timers/promises';
import { ChannelCursor, channelURL } from './channel-state.mjs';

function splitMessage(content) {
  const chunks = [];
  let remaining = content;
  while (remaining.length > 4096) {
    let limit = 4096;
    if (/[\uD800-\uDBFF]/.test(remaining[limit - 1])) limit--;
    const region = remaining.slice(0, limit);
    let splitAt = region.lastIndexOf('\n');
    if (splitAt < limit / 2) splitAt = region.lastIndexOf(' ');
    if (splitAt < limit / 2) splitAt = limit;
    else splitAt++;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

class TelegramError extends Error {
  constructor(code, kind = 'rejected') {
    super(`Telegram request ${kind} (code ${code}). Check the bot configuration and chat before retrying.`);
    this.code = code;
    this.kind = kind;
  }
}

export class TelegramSource {
  constructor({ allowedUsers, stateDirectory, photos = false }) {
    if (!Array.isArray(allowedUsers) || !allowedUsers.length || allowedUsers.some(id =>
      !/^\d+$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
      throw new Error('Configure allowedUsers as a nonempty list of numeric Telegram user IDs.');
    }
    this.allowedUsers = new Set(allowedUsers.map(id => String(Number(id))));
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(this.token ?? '')) throw new Error('Set TELEGRAM_BOT_TOKEN in the environment.');
    this.url = channelURL(process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org', 'TELEGRAM_API_URL');
    if (this.url.origin !== 'https://api.telegram.org' && !(this.url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(this.url.hostname))) {
      throw new Error('TELEGRAM_API_URL must be the official Bot API or a loopback HTTP development server.');
    }
    this.state = new ChannelCursor(stateDirectory, 'telegram', `${this.url.origin}/${this.token.split(':')[0]}`);
    // Off unless asked for: a photo uploads the phone's screen into a chat on every task.
    this.photos = photos === true;
  }

  async request(method, body = {}, signal) {
    const read = ['getMe', 'getWebhookInfo', 'getUpdates'].includes(method);
    for (let attempt = 0; ; attempt++) {
      let response, result, delay;
      try {
        response = await fetch(new URL(`/bot${this.token}/${method}`, this.url), {
          method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        const connectFailure = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code);
        if ((!read && !connectFailure) || attempt >= 2) throw new TelegramError('network', 'failed; delivery may be uncertain');
        delay = 2 ** attempt * 1000;
      }
      if (response) {
        result = await response.json().catch(() => { throw new TelegramError(response.status, 'returned invalid JSON'); });
        if (response.ok && result.ok === true) return result.result;
        const code = result.error_code ?? response.status;
        if (method === 'editMessageText' && code === 400 && /message is not modified/i.test(result.description ?? '')) return { message_id: body.message_id };
        if (method === 'editMessageText' && code === 400 && /message to edit not found|message can't be edited/i.test(result.description ?? '')) throw new TelegramError(code, 'edit unavailable');
        if (attempt >= 2) throw new TelegramError(code);
        if (code === 429) {
          const seconds = result.parameters?.retry_after;
          if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 30) throw new TelegramError(code, 'rate limited; retry later');
          delay = seconds * 1000;
        } else if (code >= 500 && (read || result.ok === false)) delay = 2 ** attempt * 1000;
        else throw new TelegramError(code);
      }
      if (delay > 0) await setTimeout(delay, undefined, { signal });
    }
  }

  async check(signal) {
    const bot = await this.request('getMe', {}, signal);
    if (!bot?.is_bot || String(bot.id) !== this.token.split(':')[0]) throw new Error('Telegram returned an unexpected bot identity.');
    const webhook = await this.request('getWebhookInfo', {}, signal);
    if (webhook.url) throw new Error('This Telegram bot has an active webhook. Remove it explicitly before starting the polling worker.');
  }

  async open(signal) {
    await this.check(signal);
    await this.state.open();
    if (this.state.cursor === null) {
      const updates = await this.request('getUpdates', { offset: -1, limit: 1, timeout: 0, allowed_updates: ['message'] }, signal);
      this.validateUpdates(updates);
      await this.state.save(updates.length ? updates.at(-1).update_id + 1 : 0);
    }
  }

  validateUpdates(updates) {
    if (!Array.isArray(updates) || updates.some(update => !Number.isSafeInteger(update.update_id) || update.update_id < 0)) throw new Error('Telegram returned invalid update IDs.');
  }

  async *read(signal) {
    const updates = await this.request('getUpdates', { offset: this.state.cursor, limit: 100, timeout: 25, allowed_updates: ['message'] }, signal);
    this.validateUpdates(updates);
    for (const update of updates.sort((a, b) => a.update_id - b.update_id)) {
      if (update.update_id < this.state.cursor) continue;
      const message = update.message;
      const sender = String(message?.from?.id);
      if (!this.allowedUsers.has(sender) || message?.from?.is_bot !== false || message.chat?.type !== 'private' ||
          String(message.chat.id) !== sender) {
        await this.acknowledge(update.update_id);
        continue;
      }
      yield { id: update.update_id, text: typeof message.text === 'string' ? message.text : null, conversation: sender };
    }
  }

  acknowledge(id) { return this.state.save(id + 1); }

  async photo(chat, image, caption) {
    const bytes = Buffer.from(image.data, 'base64');
    const type = image.mimeType || 'image/png';
    const form = new FormData();
    form.append('chat_id', String(chat));
    if (caption) form.append('caption', caption);
    form.append('photo', new Blob([bytes], { type }), type.includes('png') ? 'screen.png' : 'screen.jpg');
    let response;
    try {
      response = await fetch(new URL(`/bot${this.token}/sendPhoto`, this.url), {
        method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      // No response, so no way to tell whether Telegram accepted the body: the request may have
      // been read and the reply lost. Nothing here may be resent.
      throw new TelegramError('network', 'photo upload failed; delivery may be uncertain');
    }
    const result = await response.json().catch(() => null);
    // A rejection is a body that says `ok: false`, or a 4xx that should have carried one - a proxy
    // answering 413 for a photo that is too large. A 5xx whose body could not be read is not: a 504
    // from Telegram's gateway can arrive after the photo was accepted, and sending the text as well
    // would show the reply twice.
    if (result?.ok === false || (!result && response.status >= 400 && response.status < 500)) {
      throw new TelegramError(result?.error_code ?? response.status, 'photo rejected');
    }
    if (result?.ok !== true || !Number.isSafeInteger(result.result?.message_id)) {
      throw new TelegramError(response.status, 'photo upload returned no confirmation; delivery may be uncertain');
    }
    return result.result.message_id;
  }

  replyTo(message) {
    const chat = message.conversation;
    if (!this.allowedUsers.has(chat)) throw new Error('Telegram recipient is not configured.');
    let progress;
    return {
      acknowledge: id => this.acknowledge(id),
      send: async (text, { kind = 'notice', taskId, image } = {}) => {
        if (!text.trim()) return;
        // One upload attempt per reply, at most: after a timeout there is no way to tell whether
        // the photo arrived, and a second try hands the user the same screenshot twice.
        let photoAttempted = false;
        if (this.photos && image?.data && kind === 'final' && text.length <= 1024) {
          photoAttempted = true;
          try {
            await this.photo(chat, image, text);
            progress = undefined;
            return;
          } catch (error) {
            // Text only after a definite rejection. Anything else may already be in the chat, so
            // sending the same words again would be the duplicate this fallback exists to avoid.
            if (error.kind !== 'photo rejected') {
              console.error('telegram: photo may have arrived, not resending as text:', error.message);
              return;
            }
            console.error('telegram: photo rejected, sending text instead:', error.message);
          }
        }
        const chunks = splitMessage(text);
        if (kind === 'progress' && progress?.taskId === taskId && chunks.length === 1) {
          try {
            await this.request('editMessageText', { chat_id: chat, message_id: progress.id, text });
            return;
          } catch (error) {
            if (error.kind !== 'edit unavailable') throw error;
            progress = undefined;
          }
        }
        let first;
        for (const chunk of chunks) {
          const result = await this.request('sendMessage', { chat_id: chat, text: chunk });
          if (!Number.isSafeInteger(result?.message_id)) throw new Error('Telegram did not confirm a message ID. Check the chat before retrying.');
          first ??= result.message_id;
        }
        if (kind === 'progress' && chunks.length === 1) progress = { taskId, id: first };
        else progress = undefined;
        if (this.photos && image?.data && kind === 'final' && !photoAttempted) {
          try { await this.photo(chat, image, ''); }
          catch (error) { console.error('telegram: photo delivery failed:', error.message); }
        }
      },
    };
  }
}
