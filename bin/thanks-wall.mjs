#!/usr/bin/env node
// Adapted from all-contributors/cli at commit ea23f04fd76498dd7c21717d715119d337e54012:
// src/generate/index.js (chunk, formatLine, generateContributorsList, injectListBetweenTags)
// and src/generate/format-contributor.js (avatar block template, formatAvatarUrl).
// MIT License (MIT) Copyright (c) 2016 Kent C. Dodds, 2019 Jake Bolam, 2020 Maximilian Berkmann.
// Full license text: third_party/LICENSE.all-contributors-cli
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = 'JosssphZhou/poki';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readmes = ['README.md', 'README.zh-CN.md', 'README.zh-TW.md', 'README.ja.md', 'README.ko.md', 'README.es.md'];
const start = '<!-- THANKS-WALL:START -->';
const end = '<!-- THANKS-WALL:END -->';
const perLine = 5;
const imageSize = 80;
// Listed first, in this order; everyone else follows alphabetically.
// ZhehanZhang was the first outside contributor.
const pinned = ['ZhehanZhang'];

const usage = `Usage: node bin/thanks-wall.mjs [--check | --print]
Rebuild the README thanks wall from everyone who opened an issue or pull request on ${repo}.
  (no flag)  rewrite the list between the THANKS-WALL markers in all six READMEs
  --check    exit 1 if any README list is out of date
  --print    print the generated list without touching files
Requires an authenticated GitHub CLI (gh).`;

function gh(path, ...flags) {
  const result = spawnSync('gh', ['api', ...flags, path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`gh api ${path} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  return JSON.parse(result.stdout);
}

function people() {
  const owner = gh(`repos/${repo}`).owner.login;
  const byLogin = new Map();
  for (const item of gh(`repos/${repo}/issues?state=all&per_page=100`, '--paginate', '--slurp').flat()) {
    const user = item.user;
    if (!user || user.type === 'Bot' || user.login.endsWith('[bot]') || user.login === owner) continue;
    byLogin.set(user.login, { login: user.login, profile: user.html_url, avatar: user.avatar_url });
  }
  const rank = login => { const index = pinned.indexOf(login); return index === -1 ? pinned.length : index; };
  return [...byLogin.values()].sort((a, b) => rank(a.login) - rank(b.login) || a.login.localeCompare(b.login, 'en', { sensitivity: 'base' }));
}

function formatAvatarUrl(avatarUrl) {
  const url = new URL(avatarUrl);
  url.searchParams.set('size', String(imageSize * 2));
  return url.toString();
}

function escapeName(name) {
  return name.replace(/\|/g, '&#124;').replace(/"/g, '&quot;');
}

function formatPerson(person) {
  const name = escapeName(person.login);
  return `<a href="${person.profile}"><img src="${formatAvatarUrl(person.avatar)}" width="${imageSize}" height="${imageSize}" alt="${name}"/><br /><sub><b>${name}</b></sub></a>`;
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

function formatLine(cells) {
  const width = Math.floor((100 / perLine) * 100) / 100;
  const attributes = `align="center" valign="top" width="${width}%"`;
  return `<td ${attributes}>${cells.join(`</td>\n      <td ${attributes}>`)}</td>`;
}

function render(list) {
  if (!list.length) return '\n';
  const rows = chunk(list.map(formatPerson), perLine).map(formatLine).join('\n    </tr>\n    <tr>\n      ');
  return `\n<table>\n  <tbody>\n    <tr>\n      ${rows}\n    </tr>\n  </tbody>\n</table>\n`;
}

function inject(content, block, file) {
  const from = content.indexOf(start);
  const to = content.indexOf(end, from);
  if (from === -1 || to === -1) throw new Error(`${file} is missing the ${start} ... ${end} markers.`);
  return content.slice(0, from + start.length) + block + content.slice(to);
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !['--check', '--print', '--help', '-h'].includes(args[0]))) {
  console.error(usage);
  process.exit(1);
}
if (['--help', '-h'].includes(args[0])) {
  console.log(usage);
  process.exit(0);
}

try {
  const list = people();
  const block = render(list);
  if (args[0] === '--print') {
    process.stdout.write(block);
    process.exit(0);
  }
  const stale = [];
  for (const file of readmes) {
    const path = join(root, file);
    const before = readFileSync(path, 'utf8');
    const after = inject(before, block, file);
    if (before === after) continue;
    stale.push(file);
    if (args[0] !== '--check') writeFileSync(path, after);
  }
  const names = list.map(p => p.login).join(', ');
  if (args[0] === '--check') {
    if (stale.length) {
      console.error(`Thanks wall is out of date in ${stale.join(', ')}. Run node bin/thanks-wall.mjs to update it.\nCurrent list: ${names}`);
      process.exit(1);
    }
    console.log(`Thanks wall is up to date (${list.length}): ${names}`);
  } else {
    console.log(`${stale.length ? `Updated ${stale.join(', ')}` : 'No changes'}. Thanks wall (${list.length}): ${names}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
