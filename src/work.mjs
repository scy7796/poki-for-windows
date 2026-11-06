import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { isWin, killTree, owned } from './os.mjs';

export const work = new AsyncLocalStorage();
export function checkWork() { const context = work.getStore(); context?.signal.throwIfAborted(); if (context?.deadline !== undefined && performance.now() >= context.deadline) throw new DOMException('Observation deadline exceeded', 'TimeoutError'); }
export function signal() { return work.getStore()?.signal; }
export async function pause(ms) { checkWork(); const current = signal(); try { await delay(ms, undefined, { signal: current }); } catch (error) { throw current?.aborted ? current.reason : error; } }
export function stoppingReason(error) { return error?.stopReason ?? (error?.name === 'TimeoutError' ? 'timeout' : 'cancelled'); }
export function stopped(error) { return ['AbortError', 'TimeoutError'].includes(error?.name) || signal()?.aborted; }
export async function phase(name, fn) {
  const context = work.getStore();
  if (!context) return fn();
  const start = performance.now(), id = context.timings.length;
  const entry = { id, phase: name, parent: context.phase ?? null, elapsed_ms: 0 };
  context.timings.push(entry);
  try { return await work.run({ ...context, phase: id }, fn); }
  finally { entry.elapsed_ms = Math.round((performance.now() - start) * 100) / 100; }
}
export async function deadline(milliseconds, fn) {
  checkWork();
  const context = work.getStore();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Observation deadline exceeded', 'TimeoutError')), Math.max(0, milliseconds));
  const combined = context?.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
  try { return await work.run({ ...context, signal: combined, deadline: Math.min(context?.deadline ?? Infinity, performance.now() + milliseconds) }, fn); }
  finally { clearTimeout(timer); }
}

// Keep the request alive until the owned child actually closes, including after
// an abort. Releasing a device must not hand it over while that child still runs.
// A helper spawned here can start its own children, so an abort ends the tree:
// a POSIX process group on macOS and Linux, taskkill on Windows.
//
// `signal` is deliberately not handed to execFile. Node's own abort handling kills
// only the child it started, which ends the leader and orphans whatever the helper
// launched; the listener below is what ends the tree, so it has to be the only
// authority on stopping this process.
export function execute(file, args, { timeout = 45000, input, env, maxBuffer = 32 * 1024 * 1024 } = {}) {
  checkWork();
  const callerSignal = signal();
  return phase('external_process', () => new Promise((resolve, reject) => {
    let outcome, escalation;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(new DOMException('External process deadline exceeded', 'TimeoutError')), timeout);
    const requestSignal = callerSignal ? AbortSignal.any([callerSignal, timeoutController.signal]) : timeoutController.signal;
    const child = execFile(file, args, owned({ env: env ?? process.env, maxBuffer, encoding: 'utf8' }), (error, stdout, stderr) => {
      outcome = error ? { error: requestSignal?.aborted ? requestSignal.reason : Object.assign(new Error(`Command did not complete: ${(stderr || stdout || error.message).trim().slice(-4000)}. An input may already have been delivered; inspect before retrying.`), { stdout, stderr }) } : { stdout, stderr };
    });
    const abort = () => { killTree(child, 'SIGTERM'); escalation = setTimeout(() => killTree(child, 'SIGKILL'), 1000); };
    requestSignal?.addEventListener('abort', abort, { once: true });
    child.once('close', () => {
      clearTimeout(timer); clearTimeout(escalation); requestSignal?.removeEventListener('abort', abort);
      // Windows reuses process identifiers, and the tree was already ended with /T /F when
      // the abort fired; asking again by a stale identifier could end an unrelated tree.
      if (requestSignal.aborted && !isWin) killTree(child, 'SIGKILL');
      if (outcome?.error) reject(outcome.error);
      else if (requestSignal?.aborted) reject(requestSignal.reason);
      else resolve(outcome ?? { stdout: '', stderr: '' });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    // An abort that raced the spawn still ends the tree.
    if (requestSignal.aborted) abort();
  }));
}
