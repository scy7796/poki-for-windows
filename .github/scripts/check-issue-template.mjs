// Checks that a new issue follows one of the issue forms in .github/ISSUE_TEMPLATE.
// Runs from .github/workflows/issue-template-check.yml on issue events only.
// An issue matches a form when every required field of that form appears as a
// "### <label>" heading with an answer under it, which is what the form renders.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const MARKER = '<!-- poki-issue-template-check -->';
export const LABEL = 'needs-template';
const TEMPLATE_DIR = '.github/ISSUE_TEMPLATE';
const EXEMPT = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// Reads the small subset of issue-form YAML this repository uses.
export function parseForm(text, file) {
  const form = { file, name: file, required: [] };
  let item = null;
  const flush = () => { if (item && item.type !== 'markdown' && item.required && item.label) form.required.push(item.label); };
  for (const line of text.split('\n')) {
    let m;
    if ((m = line.match(/^name:\s*(.+)$/))) form.name = unquote(m[1]);
    else if ((m = line.match(/^\s*-\s*type:\s*(\S+)/))) { flush(); item = { type: m[1] }; }
    else if (item && (m = line.match(/^\s+label:\s*(.+)$/))) item.label = unquote(m[1]);
    else if (item && /^\s+required:\s*true\s*$/.test(line)) item.required = true;
  }
  flush();
  return form;
}

function unquote(s) { return s.trim().replace(/^(['"])(.*)\1$/, '$2'); }

export function loadForms(dir = TEMPLATE_DIR) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && !/^config\.ya?ml$/.test(f))
    .map((f) => parseForm(readFileSync(join(dir, f), 'utf8'), f))
    .filter((f) => f.required.length);
}

const norm = (s) => s.toLowerCase().replace(/[*_`:]/g, '').replace(/\s+/g, ' ').trim();

// Returns heading -> answer text for "## Heading" / "### Heading" sections.
export function sections(body) {
  const out = new Map();
  let key = null;
  for (const line of String(body || '').replace(/\r/g, '').split('\n')) {
    const m = line.match(/^#{2,4}\s+(.+?)\s*#*\s*$/);
    if (m) { key = norm(m[1]); if (!out.has(key)) out.set(key, ''); continue; }
    if (key) out.set(key, out.get(key) + line + '\n');
  }
  return out;
}

const answered = (s) => { const t = (s || '').replace(/<!--[\s\S]*?-->/g, '').trim(); return t && t !== '_No response_'; };

export function matchForm(body, forms) {
  const have = sections(body);
  return forms.find((f) => f.required.every((label) => answered(have.get(norm(label))))) || null;
}

export function commentBody(forms, repo) {
  const base = `https://github.com/${repo}`;
  const list = forms.map((f) => `- [${f.name}](${base}/issues/new?template=${f.file}): ${f.required.map((r) => `\`### ${r}\``).join(', ')}`).join('\n');
  return `${MARKER}
Thanks for opening this. It does not follow one of our issue forms, so maintainers cannot triage it yet.

**If an AI agent (Claude Code, Codex, ...) filed this for you**, ask it to read [AGENTS.md: File an issue](${base}/blob/main/AGENTS.md#file-an-issue) and then edit this issue so the body has every required section of one form, as Markdown headings with the exact English labels:

${list}

Edit this issue rather than opening a new one. When it matches a form, the \`${LABEL}\` label comes off on its own. Remove passcodes, tokens, pairing files, and private screen contents while you are at it.

感谢反馈。这个 issue 没有使用仓库的 issue 模板，维护者暂时无法分类处理。如果是 AI 代理（Claude Code、Codex 等）代你提交的，请让它先阅读 [AGENTS.md 中的 File an issue](${base}/blob/main/AGENTS.md#file-an-issue)，再编辑本 issue，按上面任一模板补齐所有必填小节（标题保留英文原文，内容可以用中文）。请直接编辑本 issue，不要重新开一个。符合模板后 \`${LABEL}\` 标签会自动移除。`;
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok && res.status !== 404) throw new Error(`${init.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 || res.status === 404 ? null : res.json();
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const { action, issue } = event;
  const repo = process.env.GITHUB_REPOSITORY;
  const path = `/repos/${repo}/issues/${issue.number}`;
  if (issue.pull_request || issue.user?.type === 'Bot') return console.log('skip: pull request or bot');
  if (EXEMPT.has(issue.author_association)) return console.log(`skip: author is ${issue.author_association}`);
  const flagged = (issue.labels || []).some((l) => l.name === LABEL);
  const forms = loadForms();
  const form = matchForm(issue.body, forms);
  console.log(`#${issue.number} ${action}: ${form ? `matches ${form.file}` : 'matches no form'}`);

  if (action === 'opened' && !form) {
    await api(`${path}/labels`, { method: 'POST', body: JSON.stringify({ labels: [LABEL] }) });
    await api(`${path}/comments`, { method: 'POST', body: JSON.stringify({ body: commentBody(forms, repo) }) });
  } else if (action === 'edited' && flagged && form) {
    await api(`${path}/labels/${LABEL}`, { method: 'DELETE' });
    const comments = await api(`${path}/comments?per_page=100`);
    const mine = (comments || []).find((c) => c.user?.type === 'Bot' && c.body?.startsWith(MARKER));
    if (mine) await api(`/repos/${repo}/issues/comments/${mine.id}`, { method: 'PATCH', body: JSON.stringify({ body: `${MARKER}\nThanks, this issue now matches the **${form.name}** form. 已符合模板，谢谢。` }) });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
