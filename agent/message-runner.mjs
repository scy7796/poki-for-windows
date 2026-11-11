import { PhoneTask } from './task-runner.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openingFromPrompt } from './opening.mjs';

const OPENING_DELAY_MS = [1500, 3000];

export class MessageRunner {
  constructor(source, options) {
    this.source = source;
    this.options = options;
    this.delivery = Promise.resolve();
  }

  send(text, metadata, delay = 0) {
    this.delivery = this.delivery.then(async () => {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return this.source.send(text, metadata);
    });
    this.delivery.catch(error => { this.failure = error; });
    return this.delivery;
  }

  async receive(message) {
    const received = performance.now();
    await this.source.acknowledge(message.id);
    if (message.text === null) { await this.send('Unsupported message. Send a plain-text task.'); return; }
    const text = message.text.trim();
    if (!text) return;
    if (this.task && !this.task.finished) {
      if (text.toLowerCase() === '/stop') { await this.task.stop(); return; }
      this.task.steer(text);
      void this.send('Added to the current task. Send /stop to stop it now.');
      return;
    }
    if (this.finished) await this.finished;
    if (text === '/stop') { await this.send('No task is running.'); return; }
    const openingOnly = this.source.progressStyle === 'opening';
    const opening = openingFromPrompt(text);
    if (opening) {
      const delay = OPENING_DELAY_MS[0] + Math.random() * (OPENING_DELAY_MS[1] - OPENING_DELAY_MS[0]);
      void this.send(opening, { kind: 'opening' }, delay).then(() => {
        console.log(JSON.stringify({ type: 'opening-sent', at: new Date().toISOString(), receiveToSendMilliseconds: performance.now() - received }));
      }).catch(() => {});
    }
    const task = new PhoneTask(text, this.options.device, {
      ...this.options, opening,
      onResult: async snapshot => {
        const directory = join(this.options.stateDirectory, 'tasks');
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(join(directory, `${snapshot.id}.json`), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
        const image = snapshot.resultShot ? this.task?.shots?.get(snapshot.resultShot) : undefined;
        await this.send(openingOnly ? snapshot.result : `${snapshot.phase}: ${snapshot.result}`, { kind: 'final', taskId: snapshot.id, image });
      },
    });
    this.task = task;
    let previous;
    task.on('warning', message => {
      console.error(message);
      if (!openingOnly && !task.finished) void this.send(message);
    });
    task.on('snapshot', snapshot => {
      if (task.finished || openingOnly) return;
      const key = JSON.stringify([snapshot.phase, snapshot.currentStep, snapshot.title]);
      if (key === previous) return;
      previous = key;
      void this.send(`${snapshot.phase}: ${snapshot.title}`, { kind: 'progress', taskId: snapshot.id });
    });
    this.finished = new Promise((resolveDone, reject) => {
      task.once('closed', () => {
        void (async () => {
          const directory = join(this.options.stateDirectory, 'tasks');
          await mkdir(directory, { recursive: true, mode: 0o700 });
          await writeFile(join(directory, `${task.snapshot.id}.json`), JSON.stringify(task.snapshot, null, 2), { mode: 0o600 });
          resolveDone();
        })().catch(reject);
      });
    });
    this.finished.catch(error => { this.failure = error; });
    void task.start();
  }

  async close() {
    if (this.task && !this.task.finished) await this.task.stop();
    await this.finished;
    await this.delivery;
  }
}
