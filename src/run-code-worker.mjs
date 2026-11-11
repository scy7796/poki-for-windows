import { parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';

// Runs one normalized async arrow function in a fresh vm context. The context has no require,
// process, fetch, module loader or timers: only JavaScript intrinsics, plus a `tools` proxy, an
// `input` value and a `console` shim built inside the context. Each `await tools.<name>(args)`
// crosses to the daemon as a JSON string and comes back as a JSON string, so no main-thread object
// ever reaches the context, and the worker's bridge functions stay in a closure the script cannot
// name. The daemon drives the call and can terminate this worker at any time.
const { code, inputJson } = workerData;
const pending = new Map();
let nextId = 0;

// Worker-realm primitives handed to the context on its global. The prelude captures them in a closure
// and deletes them from the global before the script runs: a worker-realm function's constructor is
// the worker's own Function, which code generation limits on the context do not cover.
function dispatch(name, argsJson) {
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    parentPort.postMessage({ type: 'call', id, name, argsJson });
  });
}
function emitLog(line) { parentPort.postMessage({ type: 'log', line }); }

parentPort.on('message', message => {
  if (message.type !== 'result') return;
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message.resultJson);
});

const sandbox = { __dispatch: dispatch, __emitLog: emitLog, __inputJson: inputJson ?? 'null' };
const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });

// Built inside the context so `tools`, `input` and `console` are context-realm objects. A tool call
// stringifies its argument, hands the daemon a plain string, parses the reply back into a
// context-realm object, and throws an ordinary Error the script can catch when the reply carries one.
const prelude = `'use strict';
(() => {
  const dispatch = __dispatch, emitLog = __emitLog, inputJson = __inputJson;
  delete globalThis.__dispatch; delete globalThis.__emitLog; delete globalThis.__inputJson;
  // Only primitives come back: the reply is a string and emitLog returns nothing, and the worker's
  // promise is awaited here inside a context-realm promise, so the script never holds it.
  const log = line => { emitLog(String(line)); };
  const call = (name, argsJson) => new Promise(resolve => { dispatch(name, argsJson).then(reply => resolve(String(reply))); });
  globalThis.input = JSON.parse(inputJson);
  globalThis.console = {
    log: (...a) => log(a.map(String).join(' ')),
    warn: (...a) => log('[warn] ' + a.map(String).join(' ')),
    error: (...a) => log('[error] ' + a.map(String).join(' ')),
    info: (...a) => log(a.map(String).join(' ')),
    debug: (...a) => log(a.map(String).join(' ')),
  };
  globalThis.tools = new Proxy({}, {
    get: (_, name) => {
      if (typeof name !== 'string') return undefined;
      return async (args) => {
        const reply = JSON.parse(await call(name, JSON.stringify(args ?? {})));
        if (reply.error) throw new Error(reply.error);
        return reply.result;
      };
    },
  });
})();
`;

async function run() {
  new vm.Script(prelude).runInContext(context);
  const fn = new vm.Script(`(${code})`).runInContext(context);
  const result = await fn();
  // The return value re-enters the daemon as a string, so a context-realm object never crosses back.
  const resultJson = JSON.stringify(result ?? null);
  // A function or symbol has no JSON form; say so instead of sending the daemon nothing to parse.
  if (resultJson === undefined) throw new TypeError(`The script returned a ${typeof result}, which is not JSON. Return plain data.`);
  return resultJson;
}

run().then(
  resultJson => parentPort.postMessage({ type: 'done', resultJson }),
  error => parentPort.postMessage({ type: 'done', error: error instanceof Error ? error.message : String(error) }),
);
