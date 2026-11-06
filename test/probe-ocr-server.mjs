import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const paths = process.argv.slice(2);
const child = spawn('python', ['native/ocr_win.py', '--server'], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout });
const replies = [];
lines.on('line', line => replies.push(line));
for (const p of paths) child.stdin.write(`${p}\n`);
setTimeout(() => {
  console.log('replies:', replies.length);
  for (const r of replies) { const v = JSON.parse(r); console.log('  path matches:', v.path === paths[replies.indexOf(r)], '| elements:', v.elements?.length ?? v.error); }
  child.stdin.end(); process.exit(0);
}, 12000);
