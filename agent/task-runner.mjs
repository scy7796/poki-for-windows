// Source: poki-app gateway/task-runner.mjs at 9972d34.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RouteStore } from './routes.mjs';
import { runFast } from './fast/run.mjs';
import { PiSession } from './pi-session.mjs';
import { modelConfig, safeModelError } from './model-config.mjs';
import { verifyResult } from './verify-result.mjs';
import { answerCurrentScreen } from './answer-current-screen.mjs';
import { PokiClient } from './poki-client.mjs';
import { openingSentence, openingFromPrompt } from './opening.mjs';
import { unlockDevice } from './unlock-device.mjs';
import { StepDeadline } from './step-deadline.mjs';
import { checkDeviceTools } from './device-preflight.mjs';
import { reusableActionObservation, receiptForModel } from './post-action-observation.mjs';

const terminal = new Set(['completed', 'failed', 'stopped']);
const allowedTools = new Set(['poki_mcp_status', 'get_foreground_app', 'list_apps', 'launch_app', 'take_screenshot', 'observe_device', 'list_elements', 'tap', 'tap_text', 'fill', 'type_text', 'press_key', 'hide_keyboard', 'scroll', 'swipe', 'go_back', 'handle_alert', 'batch_commands']);
const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };
const textResult = text => ({ success: true, contentItems: [{ type: 'inputText', text }] });
const structuredObservations = new Set(['observe_device', 'list_elements', 'post_action_observation']);
const reusableInputTools = new Set(['tap', 'double_tap', 'long_press', 'tap_text', 'swipe', 'drag', 'scroll', 'pinch', 'type_text', 'fill', 'press_key', 'press_button', 'go_back', 'handle_alert']);
const tracePassive = new Set(['poki_mcp_status', 'list_apps', 'get_foreground_app', 'take_screenshot', 'acquire_device', 'renew_device', 'release_device']);
const observations = new Set(['take_screenshot', 'observe_device', 'list_elements', 'get_foreground_app', 'list_apps', 'poki_mcp_status']);

const resultText = result => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
function resultData(result) {
  for (const item of result.content) {
    if (item.type !== 'text') continue;
    try {
      const value = JSON.parse(item.text);
      if (value && typeof value === 'object') return value;
    } catch {}
  }
  return null;
}

function modelContent(content) {
  return content.map(item => {
    const data = resultData({ content: [item] });
    if (!Array.isArray(data?.elements)) return item;
    const fields = ['ref', 'role', 'type', 'label', 'text', 'value', 'frame', 'enabled', 'visible', 'focused', 'selected', 'checked', 'identifier', 'id', 'trait_names'];
    return { ...item, text: JSON.stringify({ ...data,
      elements: data.elements.map(element => Object.fromEntries(fields.filter(key => element[key] !== undefined).map(key => [key, element[key]]))),
    }) };
  });
}

function batchSteps(args, blocks) {
  const steps = [];
  for (const block of blocks) {
    const value = resultData({ content: [block] });
    if (Number.isInteger(value?.step) && typeof value.tool === 'string' && typeof value.isError === 'boolean') {
      const command = args.commands[value.step - 1];
      if (value.step !== steps.length + 1 || command?.tool !== value.tool) return [];
      steps.push({ tool: value.tool, args: command.arguments ?? {}, content: [], error: value.isError, elapsedMilliseconds: value.elapsed_ms });
    } else steps.at(-1)?.content.push(block);
  }
  return steps.map(({ content, ...step }) => ({ ...step, result: resultData({ content }) ?? resultText({ content }), at: new Date().toISOString() }));
}

// Each step that ran is traced as if called alone. A batch that did not finish cleanly also gets its own
// entry, so the trace keeps the failure, the steps that did not run and the screen the batch ended on.
function batchTrace(args, result, elapsed) {
  const summary = resultData({ content: result.content.slice(-1) });
  if (!Number.isInteger(summary?.completed_steps)) return null;
  let steps = batchSteps(args, result.content.slice(0, -1));
  if (steps.length !== summary.completed_steps) steps = [];
  if (!result.isError && steps.length === args.commands.length) return steps;
  return [...steps, { tool: 'batch_commands', args, result: summary, error: !!result.isError, elapsedMilliseconds: elapsed, at: new Date().toISOString() }];
}

export class PhoneTask extends EventEmitter {
  constructor(prompt, device, options = {}) {
    super();
    this.device = device;
    this.options = options;
    this.stepTimeoutSeconds = Number(options.stepTimeout ?? process.env.POKI_AGENT_STEP_TIMEOUT ?? 60);
    this.deadline = new StepDeadline(this.stepTimeoutSeconds, () => this.fail(Object.assign(new Error(`Step timed out after ${this.stepTimeoutSeconds} seconds.`), { code: 'step_timeout' })), timing => this.snapshot.metrics.steps.push(timing));
    this.modelConfig = modelConfig(options);
    this.codex = new PiSession(this.modelConfig);
    this.poki = new PokiClient();
    this.snapshot = {
      id: randomUUID(), chatId: options.chatId ?? randomUUID(), prompt, context: options.context ?? '', phase: 'planning', plan: [], currentStep: 0,
      targetApp: null, planTitle: null,
      failure: null, details: [], resultShot: null,
      conversation: [], timeline: [], opening: options.opening ?? null,
      title: 'Planning', messages: [], result: null, stepTimeoutSeconds: this.stepTimeoutSeconds,
      startedAt: new Date().toISOString(), finishedAt: null,
      metrics: { steps: [], responses: [], requests: [], modelResponses: 0, toolCalls: 0, observations: 0, toolErrors: 0, toolMilliseconds: 0 },
    };
    this.started = performance.now();
    this.openingDelivery = options.opening ? Promise.resolve() : undefined;
    this.abort = new AbortController();
    this.trace = [];
    this.bundleId = null;
    this.stateDirectory = resolve(options.stateDirectory ?? process.env.POKI_AGENT_STATE ?? 'agent/.runtime');
    this.routes = new RouteStore(join(this.stateDirectory, 'routes'));
    this.snapshot.execution = { mode: 'explore', routeId: null, learned: null };
    this.calls = [];
    this.shots = new Map();
    this.sequence = 0;
    this.#say('user', prompt, 'taken');
    this.codex.on('warning', message => { this.snapshot.warning = message; this.emit('warning', message); this.publish(); });
    this.codex.on('response', response => { this.snapshot.metrics.responses.push(response); this.snapshot.metrics.modelResponses += 1; this.publish(); });
    this.codex.on('request', request => { this.snapshot.metrics.requests.push({ ...request, taskElapsedMilliseconds: performance.now() - this.started }); });
    this.codex.once('assistant-text', text => { void this.#announce(text).catch(error => this.fail(error)); });
    this.codex.on('message', message => void this.#message(message).catch(error => this.emit('warning', safeModelError(error))));
    this.codex.on('disconnected', error => { if (!this.finished) this.emit('warning', safeModelError(error)); });
  }

  get finished() { return terminal.has(this.snapshot.phase); }

  publish(update = {}) {
    if (this.finished) return;
    Object.assign(this.snapshot, update);
    this.emit('snapshot', this.snapshot);
  }

  #announce(text) {
    if (!this.openingDelivery) {
      this.snapshot.opening = openingSentence(text) || openingFromPrompt(this.snapshot.prompt);
      this.openingDelivery = Promise.resolve().then(() => this.options.onOpening?.(this.snapshot.opening)).then(() => this.publish());
    }
    return this.openingDelivery;
  }

  async start() {
    this.deadline.start();
    try {
      await checkDeviceTools();
      const mcpStarted = performance.now();
      const definitions = await this.poki.open(`poki-agent-${this.snapshot.id}`);
      if (this.finished) { await this.poki.close(); return; }
      this.snapshot.metrics.mcpSetupMilliseconds = performance.now() - mcpStarted;
      const statusStarted = performance.now();
      const status = await this.#call('poki_mcp_status', {});
      this.snapshot.metrics.mcpStatusMilliseconds = performance.now() - statusStarted;
      if (status.isError) throw Object.assign(new Error('Poki is unavailable. No phone action has run.'), { code: 'phone' });
      if (!this.device) {
        const report = JSON.parse(status.content.find(item => item.type === 'text')?.text ?? '{}');
        this.device = report.selected ?? null;
      }
      try {
        const foreground = await this.poki.call('get_foreground_app', { device: this.device });
        if (foreground.isError) throw new Error(resultText(foreground));
        this.initialForeground = resultData(foreground);
      } catch (error) { this.#restoreWarning(error); }
      if (this.finished) return;
      let route = this.options.images?.length ? null : await this.routes.find(this.snapshot.prompt, this.snapshot.context);
      if (route) {
        await this.#announce(this.routes.render(route.opening, route.plan.texts));
        this.bundleId = route.bundle_id;
        this.snapshot.execution = { mode: 'route', routeId: route.id, learned: null };
        this.publish({ phase: 'running', title: 'Running learned steps', planTitle: this.routes.render(route.planTitle, route.plan.texts), plan: route.plan.steps.map((_, index) => `Step ${index + 1}`), currentStep: 1 });
        if (this.finished) return;
        const choices = [route, ...(route.alternatives ?? [])];
        const outcome = await runFast({ releaseLease: false, task: { ...route.plan, device: this.device, bundle_id: this.bundleId, goal: this.snapshot.prompt, launch_for_scope: true }, signal: this.abort.signal,
          alternatives: choices.slice(1).map(choice => ({ ...choice.plan, device: this.device, bundle_id: this.bundleId, goal: this.snapshot.prompt })),
          onSelect: index => {
            route = choices[index];
            this.snapshot.execution.routeId = route.id;
            this.publish({ planTitle: this.routes.render(route.planTitle, route.plan.texts), plan: route.plan.steps.map((_, index) => `Step ${index + 1}`) });
          },
          call: async (name, args) => {
            if (name !== 'release_device' && this.finished) throw new Error('cancelled');
            if (this.snapshot.conversation.some(entry => entry.state === 'queued') && name !== 'release_device') throw new Error('task_changed');
            const result = await this.#call(name, args);
            this.#record(name, args, result);
            if (name === 'launch_app' && !result.isError) this.#noteTarget(result, args);
            if (name === 'observe_device') this.observedAfterAction = !result.isError;
            this.publish();
            return result;
          } });
        this.snapshot.execution.routeStats = outcome.stats;
        if (this.finished) return;
        let result = outcome.status === 'success' ? this.routes.readResult(route, outcome.observation) : null;
        if (!result && outcome.status === 'success' && route.readout?.kind === 'list') result = await answerCurrentScreen({
          prompt: this.snapshot.prompt, context: this.snapshot.context, observation: outcome.observation,
          modelConfig: this.modelConfig, signal: this.abort.signal,
          onWarning: message => this.emit('warning', message),
          onRequest: request => this.snapshot.metrics.requests.push({ ...request, purpose: 'route_answer' }),
          onResponse: response => {
            this.snapshot.metrics.responses.push({ ...response, purpose: 'route_answer' });
            this.snapshot.metrics.modelResponses += 1;
            this.snapshot.metrics.answerResponses = (this.snapshot.metrics.answerResponses ?? 0) + 1;
          },
        });
        if (this.finished) return;
        if (result) {
          this.snapshot.execution.answerVerification = { status: result.success ? 'verified' : 'rejected', source: 'current_screen_fields' };
          this.#submitResult(result);
          this.snapshot.currentStep = this.snapshot.plan.length;
          this.snapshot.resultShot = this.lastShot ?? null;
          await this.#complete();
          return;
        }
        outcome.handoff_reason ??= 'result_unverified';
        this.snapshot.execution.mode = 'recovery';
        this.snapshot.execution.recovery = { reason: outcome.handoff_reason, checkpoint: outcome.checkpoint };
        const returned = outcome.stats?.return_count ? ` Before it stopped, the route went back ${outcome.stats.return_count} screen${outcome.stats.return_count === 1 ? '' : 's'} looking for its start page.` : '';
        this.recovery = `Route stopped: ${outcome.handoff_reason}.${returned} Completed actions: ${outcome.checkpoint.completed_action_ids.join(', ')}. Do not relaunch the app or replay completed actions. Observe the current screen and continue. Last action outcome: ${outcome.checkpoint.action_outcome}. Observe before deciding.`;
        this.publish({ title: 'Page changed. Continuing from the current screen.' });
      }
      const modelStarted = performance.now();
      // A learned route can hand off on a Mac with no model access; say so now instead of at the step deadline.
      try { await this.codex.open(); }
      catch (error) { this.fail(Object.assign(error, { code: 'model_setup' })); return; }
      if (this.finished) { this.codex.close(); return; }
      this.snapshot.metrics.modelSetupMilliseconds = performance.now() - modelStarted;
      await this.#startModel(definitions);
    } catch (error) {
      if (error.code === 'device_setup') this.fail(error);
      else this.emit('warning', safeModelError(error));
    }
  }

  async #startModel(definitions) {
    this.modelStarted = performance.now();
    this.modelToolMilliseconds = this.snapshot.metrics.toolMilliseconds;
    const instructions = [this.poki.instructions, await readFile(new URL('./skills/iphone-unlock/SKILL.md', import.meta.url), 'utf8'), await readFile(new URL('./prompts/call-draft.md', import.meta.url), 'utf8'), await readFile(new URL('./prompts/pi-app.md', import.meta.url), 'utf8')].join('\n\n');
    const dynamicTools = definitions.filter(tool => allowedTools.has(tool.name) && !['poki_mcp_status', 'get_foreground_app'].includes(tool.name)).map(tool => ({
      type: 'function', name: tool.name, description: tool.description + (!observations.has(tool.name) ? '\nA successful action also returns a fresh structured observation, including foreground and element refs. Use it before requesting another observation.' : ''), inputSchema: tool.inputSchema,
    }));
    const apps = dynamicTools.find(tool => tool.name === 'list_apps');
    if (apps) {
      apps.description = 'Find installed apps by name or bundle identifier. query is required. Returns up to 10 matching names and bundle identifiers, never the full directory. Prefer launch_app by name when known.';
      apps.inputSchema = object({ query: { type: 'string', minLength: 1 }, include_system: { type: 'boolean' } }, ['query']);
    }
    const batch = dynamicTools.find(tool => tool.name === 'batch_commands');
    if (batch) {
      batch.description = 'Run known steps in order. May begin with launch_app followed by fill without field for a single visible input. Selectors use exact observed labels or current refs, never translated or guessed names. Use only commands.tool entries. Stop on error. Observe unknown branches before choosing the next action.';
      batch.inputSchema = structuredClone(batch.inputSchema);
      batch.inputSchema.properties.commands.items.properties.tool = { type: 'string', enum: dynamicTools.filter(tool => !['batch_commands', 'list_apps'].includes(tool.name)).map(tool => tool.name) };
    }
    dynamicTools.push(
      { type: 'function', name: 'unlock_device', description: 'Use the locally configured iPhone passcode after observing a matching empty six-digit 402x874 portrait keypad. Never include a password in arguments. Returns a fresh screenshot for verification.', inputSchema: object({ keypadConfirmed: { type: 'boolean' } }, ['keypadConfirmed']) },
      { type: 'function', name: 'report_plan', description: 'Publish a plan before phone actions. Update currentStep (1-based) on each step. title names the task.', inputSchema: object({ steps: { type: 'array', items: string, minItems: 1, maxItems: 8 }, currentStep: { type: 'integer', minimum: 1, maximum: 8 }, title: string }, ['steps', 'currentStep']) },
      { type: 'function', name: 'finish_task', description: 'Finish after the last observation verifies the requested result. If unable to complete, set success=false and explain what was completed, what blocked completion and what was tried. details must contain the requested facts, not only a page title; every value must match a whole current label or value. Declare answer.kind: action for a performed change, field for fixed values, list for requested entries. Read tasks must never use action. For field, items select current refs and label/value; when a field is combined into a label such as "Capacity,90%", use prefix "Capacity," and suffix "%" to preserve the field identity while reading a new value. For list, items select all requested current rows in order with their names/times; start_ref and end_ref identify unique section labels immediately before and after those rows. Omit section refs if no reliable boundaries exist. Never invent refs or use a heading as a requested value.', inputSchema: object({ success: { type: 'boolean' }, summary: string, details: { type: 'array', items: object({ label: string, value: string }, ['label', 'value']) }, answer: object({ kind: { type: 'string', enum: ['action', 'field', 'list'] }, items: { type: 'array', items: object({ ref: string, field: { type: 'string', enum: ['label', 'value'] }, prefix: string, suffix: string }, ['ref', 'field']) }, start_ref: string, end_ref: string }, ['kind']) }, ['success', 'summary', 'details', 'answer']) },
    );
    const { thread } = await this.codex.request('thread/start', {
      model: this.modelConfig.model, ephemeral: true, cwd: process.cwd(), approvalPolicy: 'never',
      dynamicTools, developerInstructions: instructions,
    });
    this.threadId = thread.id;
    const { turn } = await this.codex.request('turn/start', {
      threadId: thread.id, effort: 'low',
      input: [{ type: 'text', text: this.snapshot.prompt }, ...(this.options.context ? [{ type: 'text', text: this.options.context }] : []), ...(this.recovery ? [{ type: 'text', text: this.recovery }] : []), ...this.snapshot.conversation.filter(entry => entry.state === 'queued').map(entry => { entry.state = 'taken'; return { type: 'text', text: entry.text }; }), ...(this.options.images ?? []).map(path => ({ type: 'localImage', path }))],
    });
    this.turnId = turn.id;
  }

  async #message(message) {
    const { method, params, id } = message;
    if (method === 'item/tool/call') {
      if (this.finished) {
        this.codex.send({ id, result: { success: false, contentItems: [{ type: 'inputText', text: 'Task stopped. Action not executed.' }] } });
        return;
      }
      await this.#announce();
      let result;
      try { result = await this.#tool(params.tool, params.arguments); }
      catch (error) { result = { success: false, contentItems: [{ type: 'inputText', text: safeModelError(error) }] }; }
      if (result) this.codex.send({ id, result: this.#withSteering(result) });
    } else if (id !== undefined) {
      this.codex.send({ id, error: { code: -32601, message: 'Poki only supports its registered phone tools' } });
    } else if (method === 'item/completed' && params.item.type === 'agentMessage') {
      this.snapshot.messages.push(params.item.text);
      this.#say('assistant', params.item.text);
      this.publish();
    } else if (method === 'thread/tokenUsage/updated') {
      const total = params.tokenUsage.total.totalTokens;
      if (total > (this.lastTokens ?? 0)) this.snapshot.metrics.modelResponses += 1;
      this.lastTokens = total;
      this.publish();
    } else if (method === 'turn/started') {
      this.turnId = params.turn.id;
    } else if (method === 'turn/completed' && !this.finished) {
      await this.#announce();
      if (this.finished) return;
      const turn = params.turn;
      if (this.finishClaim) await this.#complete();
      else if (turn.status !== 'completed') this.emit('warning', safeModelError(turn.error?.message ?? 'Model request failed; the current step deadline remains active.'));
      else await this.#continueModel('Continue the current task with available tools. When complete or unable to complete, submit finish_task with the observed result and attempted approaches.');
    }
  }

  async #continueModel(text) {
    if (this.finished) return;
    await this.codex.request('turn/start', { threadId: this.threadId, effort: 'low', input: [{ type: 'text', text }] });
  }

  #submitResult(claim) {
    clearTimeout(this.completionTimer);
    this.finishClaim = claim;
    if (claim.success) this.deadline.suspend();
    else if (this.deadline.suspended) this.deadline.resume();
    this.verificationAttempt = { success: claim.success, status: 'pending', summary: claim.summary, details: claim.details, startedAt: new Date().toISOString() };
    (this.snapshot.execution.verifications ??= []).push(this.verificationAttempt);
    this.completionTimer = setTimeout(() => this.fail(Object.assign(new Error('Result verification did not finish within 45 seconds.'), { code: 'verification_timeout' })), 45000);
  }

  async #complete() {
    if (this.finished) return;
    const success = this.finishClaim.success;
    if (!success || this.snapshot.execution.mode !== 'route') {
      this.snapshot.execution.verification = await verifyResult({
        prompt: [this.snapshot.prompt, this.snapshot.context].filter(Boolean).join('\n\n'), success, summary: this.finishClaim.summary, details: this.finishClaim.details, answer: this.finishClaim.answer,
        trace: this.trace, finalObservation: this.completionEvidence,
        interactions: this.snapshot.conversation.filter(entry => entry.role === 'user' && entry.state === 'taken' && entry !== this.snapshot.conversation[0]).map(({ at, text }) => ({ at, text })),
        modelConfig: this.modelConfig, signal: this.abort.signal,
        onWarning: warning => this.emit('warning', warning),
        onRequest: request => this.snapshot.metrics.requests.push({ ...request, purpose: 'verification' }),
        onResponse: response => {
          this.snapshot.metrics.responses.push({ ...response, purpose: 'verification' });
          this.snapshot.metrics.verificationResponses = (this.snapshot.metrics.verificationResponses ?? 0) + 1;
        },
      });
      if (this.finished) return;
      Object.assign(this.verificationAttempt, this.snapshot.execution.verification, { endedAt: new Date().toISOString() });
      if (this.snapshot.execution.verification.status !== 'verified') {
        const reason = this.snapshot.execution.verification.reason;
        if (!success && this.snapshot.execution.failureCorrections >= 1) {
          this.fail(Object.assign(new Error(`The failure conclusion remains unverified after one further search: ${reason}`), { code: 'failure_unverified' }));
          return;
        }
        if (!success) this.snapshot.execution.failureCorrections = 1;
        this.finishClaim = null;
        this.snapshot.failure = null;
        clearTimeout(this.completionTimer);
        if (this.deadline.suspended) this.deadline.resume();
        await this.#continueModel(success
          ? `The result is not verified: ${reason}. Continue gathering evidence or completing missing requirements. If unable to complete, submit finish_task(success=false) with what was done, the blocker and attempts.`
          : `The failure conclusion is not verified: ${reason}. Continue searching the current page by scrolling down and inspecting the content until it no longer changes, then follow any matching entry. Use the remaining step time. This is the one correction for an unsupported failure. Report the observed result, or explain a proven blocker and what you tried.`);
        return;
      }
    }
    if (this.verificationAttempt?.status === 'pending') Object.assign(this.verificationAttempt, { status: 'verified', reason: 'Current route observation verified the result.', endedAt: new Date().toISOString() });
    clearTimeout(this.completionTimer);
    this.snapshot.details = this.finishClaim.details ?? this.snapshot.details;
    if (success) {
      await this.#completeObservation();
      if (this.finished) return;
      await mkdir(join(this.stateDirectory, 'trajectories'), { recursive: true, mode: 0o700 });
      const path = join(this.stateDirectory, 'trajectories', `${this.snapshot.id}.json`);
      await writeFile(path, JSON.stringify({ prompt: this.snapshot.prompt, bundle_id: this.bundleId, trace: this.trace }, null, 2), { mode: 0o600 });
      this.snapshot.execution.trajectory = path;
      if (!this.snapshot.conversation.some(entry => entry.role === 'user' && entry !== this.snapshot.conversation[0])) {
        this.snapshot.execution.learned = await this.routes.learn({ id: this.snapshot.id, prompt: this.snapshot.prompt, context: this.snapshot.context,
          bundleId: this.bundleId, device: this.device, trace: this.trace, details: this.snapshot.details, answer: this.finishClaim.answer, planTitle: this.snapshot.planTitle, opening: this.snapshot.opening, verify: async () => this.snapshot.execution.verification?.status === 'verified' });
      }
    }
    if (this.finished) return;
    this.snapshot.metrics.totalMilliseconds = performance.now() - this.started;
    this.snapshot.metrics.modelSessionMilliseconds = this.modelStarted ? performance.now() - this.modelStarted - (this.snapshot.metrics.toolMilliseconds - this.modelToolMilliseconds) : 0;
    this.publish({ phase: success ? 'completed' : 'failed', title: success ? 'Task completed' : 'Task incomplete', result: this.finishClaim.summary, finishedAt: new Date().toISOString() });
    await this.close();
  }

  async #tool(name, args) {
    if (this.finished) return { success: false, contentItems: [{ type: 'inputText', text: 'Task stopped. Action not executed.' }] };
    if (name !== 'finish_task' && this.finishClaim) {
      this.finishClaim = null;
      clearTimeout(this.completionTimer);
      if (this.verificationAttempt?.status === 'pending') Object.assign(this.verificationAttempt, { status: 'reopened', reason: `Model continued with ${name}.`, endedAt: new Date().toISOString() });
      if (this.deadline.suspended) this.deadline.resume();
    }
    if (name === 'report_plan') {
      if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 8 || !Number.isInteger(args.currentStep) || args.currentStep < 1 || args.currentStep > args.steps.length || args.steps.some(step => typeof step !== 'string')) throw new Error('Invalid model plan');
      this.deadline.advance(args.currentStep);
      this.publish({ plan: args.steps, currentStep: args.currentStep, title: args.steps[args.currentStep - 1], phase: 'running', planTitle: args.title ?? this.snapshot.planTitle });
      return textResult('Plan published. Continue.');
    }
    if (name === 'finish_task') {
      if (typeof args.summary !== 'string' || typeof args.success !== 'boolean') throw new Error('Invalid task result');
      if (args.success && !this.observedAfterAction) throw new Error('Observe the result after the last action before reporting success');
      this.#submitResult(args);
      this.snapshot.execution.answerPlan = args.answer;
      this.snapshot.details = Array.isArray(args.details) ? args.details : [];
      this.snapshot.resultShot = this.lastShot ?? null;
      this.snapshot.failure = args.success ? null : { code: 'reported' };
      return textResult('Result recorded. Explain it briefly to the user.');
    }
    if (name === 'unlock_device') {
      if (args.keypadConfirmed !== true) return { success: false, contentItems: [{ type: 'inputText', text: 'Observe the keypad layout and current input before using the six-digit helper.' }] };
      const lease = await this.#call('acquire_device', { device: this.device, ttl_seconds: 60 });
      const leaseId = resultData(lease)?.lease_id;
      if (lease.isError || !leaseId) return { success: false, contentItems: [{ type: 'inputText', text: 'The device lease could not be acquired.' }] };
      try {
        await unlockDevice(this.device, this.abort.signal);
        const shot = await this.#call('take_screenshot', { device: this.device });
        this.#record('unlock_device', { keypadConfirmed: true }, shot);
        return { success: !shot.isError, contentItems: [{ type: 'inputText', text: 'Unlock input sent. Verify this screenshot before continuing.' }, ...shot.content.flatMap(item => item.type === 'image' ? [{ type: 'inputImage', imageUrl: `data:${item.mimeType};base64,${item.data}` }] : item.type === 'text' ? [{ type: 'inputText', text: item.text }] : [])] };
      } catch (error) {
        return { success: false, contentItems: [{ type: 'inputText', text: safeModelError(error) }] };
      } finally { await this.#call('release_device', { lease_id: leaseId }).catch(() => {}); }
    }
    if (!this.snapshot.plan.length) throw new Error('Publish a plan before phone actions');
    const actual = this.#validate(name, args);
    const observing = observations.has(name);
    if (!observing) { this.observedAfterAction = false; this.completionEvidence = undefined; }
    let result = await this.#call(name, actual);
    if (!result.isError && name === 'launch_app') {
      this.#noteTarget(result, args);
      this.targetOpened = true;
    }
    else if (name === 'batch_commands') {
      for (let index = 0; index < result.content.length; index++) {
        const step = resultData({ content: [result.content[index]] });
        if (step?.tool !== 'launch_app' || step.isError) continue;
        const command = actual.commands[step.step - 1];
        if (command?.tool !== 'launch_app') continue;
        this.targetOpened = true;
        this.#noteTarget({ content: result.content.slice(index + 1, index + 2) }, command.arguments);
      }
    }
    else if (name === 'get_foreground_app') { this.#noteTarget(result); }
    else if (['take_screenshot', 'observe_device', 'list_elements'].includes(name)) {
      this.observedAfterAction = true;
      const observed = resultData(result);
    }
    if (name === 'batch_commands' && !result.isError && structuredObservations.has(this.trace.at(-1)?.tool)) this.observedAfterAction = true;
    if (this.observedAfterAction && ['batch_commands', 'take_screenshot', 'observe_device', 'list_elements'].includes(name)) this.completionEvidence = result.content;
    this.#record(name, args, result);
    if (!observing && !result.isError) {
      const observed = await this.#completeObservation(result);
      if (observed) {
        result = { ...result, content: [...result.content, ...observed.content] };
        if (!observed.isError) { this.observedAfterAction = true; this.completionEvidence = observed.content; }
      }
    }
    // Record the unabridged action evidence before changing model-facing text.
    // An eligible reuse adds one top-level trimmed observation; the action's
    // nested copy must not be sent to the model again.
    if (!observing) result = { ...result, content: receiptForModel(result.content) };
    this.publish();
    return {
      success: !result.isError,
      contentItems: modelContent(result.content).flatMap(item => item.type === 'text' ? [{ type: 'inputText', text: item.text }] : item.type === 'image' ? [{ type: 'inputImage', imageUrl: `data:${item.mimeType};base64,${item.data}` }] : []),
    };
  }

  async #completeObservation(actionResult) {
    const last = this.trace.findLast(entry => !tracePassive.has(entry.tool));
    if (!last || structuredObservations.has(last.tool)) return;
    const receipt = actionResult && resultData(actionResult);
    const reused = reusableActionObservation(receipt, this.device, this.targetBundle ?? null);
    if (reused) {
      // Reused receipt evidence is not a new MCP call.
      this.trace.push({ tool: 'post_action_observation', args: { source: 'action_receipt', receipt_id: receipt.receipt_id },
        result: reused, error: false, reused: true, elapsedMilliseconds: 0, at: new Date().toISOString() });
      this.#mark({ kind: 'observation_reused', source: 'action_receipt', observationId: reused.observation.id });
      return { content: [{ type: 'text', text: JSON.stringify(reused) }] };
    }
    const args = { device: this.device };
    const result = await this.#call('list_elements', args);
    this.#record('list_elements', args, result);
    return result;
  }

  async #call(name, args) {
    const started = performance.now();
    this.snapshot.metrics.toolCalls += 1;
    if (['take_screenshot', 'observe_device', 'list_elements', 'get_foreground_app', 'poki_mcp_status'].includes(name)) this.snapshot.metrics.observations += 1;
    const { query, ...deviceArgs } = args;
    let result;
    try { result = await this.poki.call(name, name === 'list_apps' ? deviceArgs : args); }
    catch (error) { result = { isError: true, content: [{ type: 'text', text: safeModelError(error) }] }; }
    if (name === 'list_apps' && !result.isError) {
      const directory = resultData(result);
      const term = query.trim().toLocaleLowerCase();
      const matches = (directory?.apps ?? []).filter(app => [app.name, app.bundle_id, ...(app.aliases ?? [])]
        .some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(term)));
      result = { ...result, content: [{ type: 'text', text: JSON.stringify({
        apps: matches.slice(0, 10).map(app => ({ name: app.name?.slice(0, 160), bundle_id: app.bundle_id?.slice(0, 256) })),
        truncated: matches.length > 10, ...(matches.length > 10 ? { hint: 'Use a more specific query.' } : {}),
      }) }] };
    }
    const elapsed = performance.now() - started;
    this.snapshot.metrics.toolMilliseconds += elapsed;
    this.calls.push({ tool: name, elapsedMilliseconds: elapsed, isError: !!result.isError });
    const value = resultData(result) ?? resultText(result);
    if (name === 'acquire_device' && !result.isError) this.deviceLease = value.lease_id;
    if (name === 'release_device' && !result.isError) this.deviceLease = null;
    if (!observations.has(name) && !tracePassive.has(name)) {
      this.lastActionForeground = null;
      this.awaitingActionForeground = true;
    }
    if (this.awaitingActionForeground) {
      for (const item of result.content) {
        const data = resultData({ content: [item] });
        const foreground = data?.foreground_after ?? data?.foreground
          ?? (name === 'launch_app' && !result.isError ? data : null);
        if (foreground?.bundle_id || foreground?.pid) {
          this.lastActionForeground = foreground;
          this.awaitingActionForeground = false;
        }
      }
    }
    if (!observations.has(name) && !tracePassive.has(name)) {
      this.actionSincePage = !result.isError && value?.sent !== false ? { tool: name, arguments: args } : null;
    }
    const steps = name === 'batch_commands' ? batchTrace(args, result, elapsed) : null;
    if (!result.isError) for (const step of steps ?? []) {
      if (!step.error && ['scroll', 'swipe'].includes(step.tool)) this.deadline.observe(step.result, { tool: step.tool });
    }
    if (this.deadline.observe(result, !result.isError && this.actionSincePage)) this.actionSincePage = null;
    if (steps) this.trace.push(...steps);
    else this.trace.push({ tool: name, args, result: value, error: !!result.isError, elapsedMilliseconds: elapsed, at: new Date().toISOString() });
    if (result.isError) this.snapshot.metrics.toolErrors += 1;
    this.publish();
    return result;
  }

  #validate(name, args) {
    if (!allowedTools.has(name)) throw new Error('Tool is not authorized for this task');
    if (name === 'list_apps' && (typeof args.query !== 'string' || !args.query.trim())) throw new Error('list_apps requires a specific app name or bundle identifier in query.');
    if (name === 'batch_commands') return { commands: args.commands.map(command => {
      const tool = command.tool.replace(/^mcp__poki-mcp__/, '');
      if (tool === 'batch_commands') throw new Error('Nested batches are not allowed');
      if (tool === 'list_apps') throw new Error('Call list_apps separately with a specific query.');
      return { tool, arguments: this.#validate(tool, command.arguments ?? {}) };
    }), stop_on_error: true };
    return name === 'poki_mcp_status' ? {} : { ...args, device: this.device,
      ...(reusableInputTools.has(name) ? { return_observation: true } : {}) };
  }

  #say(role, text, state = null) {
    const entry = { seq: ++this.sequence, at: new Date().toISOString(), role, text, state };
    this.snapshot.conversation.push(entry);
    return entry;
  }

  #mark(entry) {
    this.snapshot.timeline.push({ seq: ++this.sequence, at: new Date().toISOString(), step: this.snapshot.currentStep, ...entry });
  }

  #record(tool, args, result) {
    const { device: _device, ...shown } = args ?? {};
    const raw = resultText(result).slice(0, 2000);
    const parsed = resultData(result);
    const image = result.content.find(item => item.type === 'image');
    let shot = null;
    if (image) {
      shot = randomUUID();
      this.shots.set(shot, { mimeType: image.mimeType, data: image.data });
      this.lastShot = shot;
      for (const entry of this.snapshot.timeline) if (entry.kind === 'tool' && !entry.shot && entry.step === this.snapshot.currentStep) entry.shot = shot;
    }
    this.#mark({ kind: 'tool', tool, args: shown, ok: !result.isError, observe: observations.has(tool), sent: parsed?.sent ?? null, screenChanged: parsed?.screen_change_verified ?? null, elapsedMilliseconds: Math.round(this.calls.at(-1)?.elapsedMilliseconds ?? 0), raw: image ? '' : raw, shot });
  }

  #noteTarget(result, args = {}) {
    const text = result.content.find(item => item.type === 'text')?.text;
    let found = {};
    try { found = JSON.parse(text) ?? {}; } catch {}
    const name = found.name ?? args.name;
    if (name) { this.snapshot.targetApp = name; this.targetName = name; }
    const bundle = found.bundle_id ?? args.bundle_id;
    if (bundle) { this.targetBundle = bundle; this.bundleId ??= bundle; }
  }

  steer(text) {
    if (this.finished) throw new Error('Task has ended');
    const entry = this.#say('user', text, 'queued');
    this.publish();
    return entry;
  }

  withdraw(seq) {
    const index = this.snapshot.conversation.findIndex(entry => entry.seq === seq && entry.state === 'queued');
    if (index === -1) throw new Error('This message has been delivered and cannot be withdrawn');
    this.snapshot.conversation.splice(index, 1);
    this.publish();
  }

  #withSteering(result) {
    const queued = this.snapshot.conversation.filter(entry => entry.state === 'queued');
    if (!queued.length || this.finished) return result;
    for (const entry of queued) {
      entry.state = 'taken';
      this.#mark({ kind: 'user', verb: 'added', label: entry.text });
    }
    this.publish();
    return { ...result, contentItems: [...result.contentItems, { type: 'inputText', text: `The user added: ${queued.map(entry => entry.text).join('; ')}` }] };
  }

  async stop() {
    if (this.finished) return;
    this.abort.abort();
    this.publish({ phase: 'stopped', result: 'Stopped. An in-flight action may have run. Check the device.', title: 'Task stopped', finishedAt: new Date().toISOString() });
    if (this.threadId && this.turnId) await this.codex.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }).catch(() => {});
    await this.close();
  }

  fail(error) {
    error = Object.assign(new Error(safeModelError(error)), { code: error.code });
    if (this.finished) return;
    this.abort.abort();
    const page = this.deadline.pageTitle ?? 'page not identified';
    const where = this.snapshot.currentStep ? `step ${this.snapshot.currentStep} (${this.snapshot.title}, ${page})` : 'connection setup';
    const attempted = [...new Set(this.calls.filter(call => !observations.has(call.tool)).map(call => call.tool))].join(', ') || 'no device actions';
    let result = error.code === 'device_setup' && /\p{Script=Han}/u.test(this.snapshot.prompt)
      ? '这台 Mac 的手机读取工具还没准备好，暂时无法操作手机。请先运行 ./bin/setup 安装工具，再重启通道。'
      : (/\p{Script=Han}/u.test(this.snapshot.prompt) ? `任务失败。执行到第 ${this.snapshot.currentStep} 步（${this.snapshot.title}，${page}）。${error.code === 'step_timeout' ? `已达到 ${this.stepTimeoutSeconds} 秒时限。` : error.message} 已尝试：${attempted}。结果尚未核实。` : `Failed at ${where}. ${error.message} Tried: ${attempted}. Result remains unverified.`);
    if (error.code === 'verification_timeout') {
      Object.assign(this.verificationAttempt, { status: 'unavailable', reason: error.message, endedAt: new Date().toISOString() });
      result = /\p{Script=Han}/u.test(this.snapshot.prompt)
        ? `已得到以下候选结果，但未能在 45 秒内完成核实，不能确认任务成功：\n${this.finishClaim.summary}`
        : `Result verification timed out after 45 seconds. The following answer is preserved but unverified; task success is not confirmed:\n${this.finishClaim.summary}`;
    }
    this.publish({ phase: 'failed', title: 'Task interrupted', result, failure: { code: error.code ?? 'model' }, finishedAt: new Date().toISOString() });
    void this.close();
  }

  #restoreWarning(error) {
    const warning = `Could not restore the original app: ${safeModelError(error)}`;
    this.snapshot.warning = warning;
    this.emit('warning', warning);
  }

  async #restoreForeground() {
    const original = this.initialForeground;
    const last = this.lastActionForeground;
    if (!original || !last) return;
    const response = await this.poki.call('get_foreground_app', { device: this.device });
    if (response.isError) throw new Error(resultText(response));
    const current = resultData(response);
    const same = (a, b) => a && b && (a.pid && b.pid ? a.pid === b.pid : a.bundle_id && b.bundle_id && a.bundle_id === b.bundle_id);
    if (!same(current, last) || same(current, original)) return;
    const home = original.bundle_id === 'com.apple.springboard' || original.name === 'SpringBoard'
      || (!original.bundle_id && !original.name?.trim());
    const restored = await this.poki.call(home ? 'press_button' : 'launch_app', {
      device: this.device,
      ...(home ? { button: 'home' } : original.bundle_id ? { bundle_id: original.bundle_id } : { name: original.name }),
    });
    if (restored.isError || resultData(restored)?.sent === false) throw new Error(resultText(restored));
    if (home) {
      const foreground = await this.poki.call('get_foreground_app', { device: this.device });
      if (foreground.isError) throw new Error(resultText(foreground));
      if (!same(resultData(foreground), original)) throw new Error('Home did not restore the original foreground');
    }
  }

  async close() {
    if (this.closing) return this.closing;
    clearTimeout(this.completionTimer);
    this.deadline.stop();
    this.codex.close();
    this.closing = (async () => {
      try {
        await this.options.onResult?.(this.snapshot);
        await this.#restoreForeground().catch(error => this.#restoreWarning(error));
      } finally {
        try {
          if (this.deviceLease) await this.poki.call('release_device', { lease_id: this.deviceLease });
        } finally { await this.poki.close(); }
      }
    })().finally(() => this.emit('closed'));
    return this.closing;
  }
}
