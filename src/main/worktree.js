// Git worktree lifecycle. Every git call goes through execFile with an
// argument array; nothing is ever passed through a shell.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RESERVED = new Set(['con', 'prn', 'aux', 'nul', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`com${n}`, `lpt${n}`])]);
const SLUG_MAX = 32;

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} failed: ${(stderr || err.message).trim()}`));
      else resolve(stdout.trim());
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

module.exports = { isGitRepo, listBranches, makeSlug, createWorktree, removeWorktree, isDirty };
