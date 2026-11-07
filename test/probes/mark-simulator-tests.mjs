// Marks coordination tests that need the iOS Simulator, which only Xcode provides.
// The macOS suite drives both a simulated device and a faked physical one; a Windows
// host can only ever build the physical half, so those cases are skipped with a reason
// rather than left failing for a reason that has nothing to do with the port.
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
let source = readFileSync(path, 'utf8');
const markers = /simulatorOnly|simulatorBooted|secondSimulator|start_simulator|shut_down_simulator|--hid-session|xcrun|simulatorModels|build\/simulator|fixture-sim|\.\.\.simulator\b|twoSimulators|inputConnections\(|inputSent\(|\blocating\b/i;

const header = `import { isWin } from '../src/os.mjs';\n\n// A simulator is Xcode's; where it does not exist its cases are skipped, not failed.\nconst needsSimulator = isWin && 'needs the iOS Simulator, which only Xcode provides';\n`;

if (!source.includes('const needsSimulator')) {
  source = source.replace("import { fixture, value } from './fixture.mjs';\n", `import { fixture, value } from './fixture.mjs';\n${header}`);
}

const lines = source.split('\n');
let marked = 0;
for (let index = 0; index < lines.length; index++) {
  // Nested cases inside a loop are indented; their options object sits after the name too.
  if (!/^\s*test\(/.test(lines[index])) continue;
  let end = index + 1;
  let depth = 0;
  let started = false;
  for (; end < lines.length; end++) {
    for (const character of lines[end]) {
      if (character === '{' || character === '(') { depth += 1; started = true; }
      else if (character === '}' || character === ')') depth -= 1;
    }
    if (started && depth <= 0) break;
  }
  const body = lines.slice(index, end + 1).join('\n');
  if (!markers.test(body) || body.includes('needsSimulator')) continue;
  // Both shapes appear: an options object, and the bare callback.
  const withOptions = lines[index].match(/^(\s*)test\((['"`])(.*?)\2,\{/);
  const bare = lines[index].match(/^(\s*)test\((['"`])(.*?)\2,\s*async/);
  if (withOptions) {
    lines[index] = lines[index].replace(/^(\s*)test\((['"`])(.*?)\2,\{/, "$1test($2$3$2,{skip:needsSimulator,");
    marked += 1;
  } else if (bare) {
    lines[index] = lines[index].replace(/^(\s*)test\((['"`])(.*?)\2,\s*async/, "$1test($2$3$2,{skip:needsSimulator},async");
    marked += 1;
  } else {
    console.error('unrecognised test header:', lines[index].slice(0, 120));
  }
}
writeFileSync(path, lines.join('\n'));
console.log(`marked ${marked} simulator tests`);
