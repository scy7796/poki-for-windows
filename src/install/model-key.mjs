// The model key goes from the Mac's keychain to Poki on the iPhone sealed to a key the phone made
// and never lets out (poki.model-key/1). Poki writes its public key in Documents/PokiSetup/poki-hello.json;
// the installer seals the key here, in its own memory, and only the sealed file crosses USB.
// Sealing: ephemeral P-256 ECDH with the phone's key, HKDF-SHA256, AES-256-GCM. The additional data
// binds the schema, the phone key's id, the provider, Poki's bundle id and an expiry, so a sealed key
// opens only in that Poki, for that provider, once. native/ios-app/Poki/Setup/ModelKeySeal.swift opens it.
import { createCipheriv, createDecipheriv, createECDH, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const SCHEMA = 'poki.model-key/1';
export const KEM = 'P256-HKDF-SHA256-AES256GCM';
// The providers Poki can take a key for (ModelProvider in native/ios-app/Poki/Chat/ModelKeys.swift).
export const PROVIDERS = ['anthropic', 'openai', 'deepseek', 'gemini', 'openrouter'];
const LIFETIME_MS = 10 * 60 * 1000;

const b64u = bytes => Buffer.from(bytes).toString('base64url');
const unb64u = text => Buffer.from(String(text ?? ''), 'base64url');
export const keyId = publicKey => createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
const aad = ({ key_id, provider, bundle_id, expires_at }) => Buffer.from([SCHEMA, key_id, provider, bundle_id, expires_at].join('\n'));
const derive = (shared, epk, recipient) => Buffer.from(hkdfSync('sha256', shared, Buffer.concat([epk, recipient]), Buffer.from(SCHEMA), 32));

// The phone's public key from poki-hello.json, checked: an uncompressed P-256 point whose id matches.
export function phoneKey(hello) {
  const offer = hello?.model_key;
  if (!offer || offer.kem !== KEM) return null;
  const publicKey = unb64u(offer.public_key);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || keyId(publicKey) !== offer.key_id) return null;
  return { publicKey, keyId: offer.key_id };
}

export function seal({ secret, provider, bundleId, phone, now = Date.now() }) {
  const sender = createECDH('prime256v1');
  const epk = sender.generateKeys();
  const key = derive(sender.computeSecret(phone.publicKey), epk, phone.publicKey);
  const header = { schema: SCHEMA, key_id: phone.keyId, provider, bundle_id: bundleId, expires_at: new Date(now + LIFETIME_MS).toISOString() };
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(header));
  const body = Buffer.concat([cipher.update(JSON.stringify({ secret }), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return Buffer.from(`${JSON.stringify({ ...header, epk: b64u(epk), nonce: b64u(nonce), ct: b64u(body) })}\n`);
}

// What Poki does on the phone, for the simulated Poki in fake-bridge.mjs and the tests.
export function open(sealed, { privateKey, bundleId, now = Date.now() }) {
  const env = JSON.parse(sealed);
  if (env.schema !== SCHEMA) throw new Error('not a poki.model-key/1 file');
  if (env.bundle_id !== bundleId) throw new Error('sealed for another app');
  if (Date.parse(env.expires_at) < now) throw new Error('the sealed key has expired');
  const me = createECDH('prime256v1');
  me.setPrivateKey(privateKey);
  const epk = unb64u(env.epk);
  const key = derive(me.computeSecret(epk), epk, me.getPublicKey());
  const body = unb64u(env.ct);
  const decipher = createDecipheriv('aes-256-gcm', key, unb64u(env.nonce));
  decipher.setAAD(aad(env));
  decipher.setAuthTag(body.subarray(-16));
  const plain = Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()]);
  return { provider: env.provider, secret: JSON.parse(plain).secret };
}

// The key, read from the login keychain into this process only: never argv, a file or a log line.
export async function readKeychainKey(item) {
  try {
    const { stdout } = await exec('security', ['find-generic-password', '-s', item, '-w']);
    const secret = stdout.replace(/\n$/, '');
    return secret || null;
  } catch {
    return null;
  }
}
