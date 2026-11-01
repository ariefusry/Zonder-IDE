// Git worktree lifecycle. Every git call goes through execFile with an
// argument array; nothing is ever passed through a shell.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RESERVED = new Set(['con', 'prn', 'aux', 'nul', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`com${n}`, `lpt${n}`])]);
const SLUG_MAX = 32;

const MAX_DIFF = 200 * 1024;

// okCodes: exit codes that still mean success (diff --no-index exits 1 when the
// files differ). raw: keep stdout untrimmed, for NUL-separated names.
function git(cwd, args, { okCodes = [], raw = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !okCodes.includes(err.code)) reject(new Error(`git ${args[0]} failed: ${(stderr || err.message).trim()}`));
      else resolve(raw ? stdout : stdout.trim());
    });
  });
}

function samePath(a, b) {
  const norm = (p) => fs.realpathSync.native(path.resolve(p)).toLowerCase();
  return norm(a) === norm(b);
}

// True only for the top level of a working tree: worktrees are placed next to
// the repo root, so a subfolder would put them in the wrong place.
async function isGitRepo(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    return samePath(await git(dir, ['rev-parse', '--show-toplevel']), dir);
  } catch {
    return false;
  }
}

async function listBranches(repo) {
  const out = await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  return out ? out.split(/\r?\n/) : [];
}

// The branch checked out in the main repo; the spawn modal preselects it.
async function currentBranch(repo) {
  try {
    return await git(repo, ['symbolic-ref', '--short', '-q', 'HEAD']);
  } catch {
    return null; // detached HEAD
  }
}

function makeSlug(name, taken) {
  let base = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  if (!base) base = 'agent';
  if (RESERVED.has(base)) base = `a-${base}`;

  let slug = base;
  for (let n = 2; taken.has(slug); n++) {
    const suffix = `-${n}`;
    slug = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '') + suffix;
  }
  return slug;
}

function worktreesDir(repo) {
  return path.join(path.dirname(path.resolve(repo)), '.zonder-worktrees');
}

async function createWorktree({ repo, baseBranch, name, agentId, taken }) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(agentId)) throw new Error('invalid agent id');
  // Checking against real branch names also stops option-like values ("--x").
  if (!(await listBranches(repo)).includes(baseBranch)) throw new Error(`base branch not found: ${baseBranch}`);
  const slug = makeSlug(name, taken);
  const branch = `zonder/${slug}-${agentId.slice(0, 6).toLowerCase()}`;
  const wtPath = path.join(worktreesDir(repo), agentId);
  if (fs.existsSync(wtPath)) throw new Error(`worktree path already exists: ${wtPath}`);
  await git(repo, ['worktree', 'add', '-b', branch, wtPath, baseBranch]);
  return { path: wtPath, branch, slug };
}

async function removeWorktree({ repo, path: wtPath, branch, deleteBranch, force = false }) {
  const dir = worktreesDir(repo);
  const rel = path.relative(dir, path.resolve(wtPath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`refusing to remove a path outside ${dir}`);
  if (deleteBranch && !branch.startsWith('zonder/')) throw new Error('refusing to delete a branch outside zonder/');
  await git(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), wtPath]);
  // -D: agent branches are normally unmerged, and deleting one is the owner's explicit choice.
  if (deleteBranch) await git(repo, ['branch', '-D', branch]);
}

async function isDirty(wtPath) {
  return (await git(wtPath, ['status', '--porcelain'])) !== '';
}

function exists(wtPath) {
  return fs.existsSync(wtPath);
}

// Worktrees git knows of under this repo's .zonder-worktrees folder: [{path, branch}].
async function listAgentWorktrees(repo) {
  const dir = worktreesDir(repo);
  const out = [];
  let cur = null;
  for (const line of (await git(repo, ['worktree', 'list', '--porcelain'])).split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      cur = { path: path.resolve(line.slice(9)), branch: null };
      const rel = path.relative(dir, cur.path);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) out.push(cur);
    } else if (line.startsWith('branch refs/heads/') && cur) {
      cur.branch = line.slice('branch refs/heads/'.length);
    }
  }
  return out;
}

// `git diff --name-status -z -M` output -> [{path, status, oldPath?}]. Type
// changes count as edits and copies as new files.
function parseNameStatus(text) {
  const parts = text.split('\0');
  const out = [];
  for (let i = 0; i < parts.length && parts[i]; ) {
    const code = parts[i][0];
    if (code === 'R' || code === 'C') {
      const [oldPath, file] = [parts[i + 1], parts[i + 2]];
      out.push(code === 'R' ? { path: file, status: 'R', oldPath } : { path: file, status: 'A' });
      i += 3;
    } else {
      out.push({ path: parts[i + 1], status: code === 'T' ? 'M' : code });
      i += 2;
    }
  }
  return out;
}

// Diff flags that keep output plain whatever the user's git config says.
const DIFF = ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff'];

// Everything the agent changed since it branched off: commits, uncommitted
// edits and untracked files, against the merge-base with its base branch.
async function listChanges(wtPath, baseBranch) {
  const base = await git(wtPath, ['merge-base', baseBranch, 'HEAD']);
  const tracked = parseNameStatus(await git(wtPath, ['diff', '--no-color', '--name-status', '-z', '-M', base], { raw: true }));
  const untracked = (await git(wtPath, ['ls-files', '--others', '--exclude-standard', '-z'], { raw: true }))
    .split('\0')
    .filter(Boolean)
    .map((p) => ({ path: p, status: 'A' }));
  const files = [...tracked, ...untracked].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { base, files };
}

// Read-only diff of one changed file. oldPath shows a rename as one diff.
async function fileDiff(wtPath, base, file, oldPath) {
  const untracked = (await git(wtPath, ['ls-files', '--others', '--exclude-standard', '-z', '--', file], { raw: true })) !== '';
  const text = untracked
    ? await git(wtPath, [...DIFF, '--no-index', '--', '/dev/null', file], { okCodes: [1], raw: true })
    : await git(wtPath, [...DIFF, '-M', base, '--', ...(oldPath ? [oldPath] : []), file], { raw: true });
  if (/^Binary files .* differ$/m.test(text)) return { path: file, text: '', truncated: false, binary: true };
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= MAX_DIFF) return { path: file, text, truncated: false, binary: false };
  // Cut on a line end so no line or multi-byte character is split.
  const cut = bytes.subarray(0, MAX_DIFF).lastIndexOf(0x0a);
  return { path: file, text: bytes.subarray(0, cut + 1).toString('utf8'), truncated: true, binary: false };
}

module.exports = { isGitRepo, listBranches, currentBranch, makeSlug, createWorktree, removeWorktree, isDirty, exists, listAgentWorktrees, parseNameStatus, listChanges, fileDiff, MAX_DIFF };
