// Probe: how much of the OCR cost is model load, and does one process reuse it?
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const path = process.argv[2];
const child = spawn('python', ['native/ocr_win.py', '--server'], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout });
const pending = [];
lines.on('line', line => pending.shift()?.(line));

const ask = () => new Promise(resolve => {
  pending.push(resolve);
  child.stdin.write(`${path}\n`);
});

const started = performance.now();
const first = await ask();
const one = performance.now() - started;
const secondStart = performance.now();
const second = await ask();
const two = performance.now() - secondStart;
child.stdin.end();
console.log('first ms', Math.round(one), 'elements', JSON.parse(first).length);
console.log('second ms', Math.round(two), 'elements', JSON.parse(second).length, 'same', first === second);
process.exit(0);
