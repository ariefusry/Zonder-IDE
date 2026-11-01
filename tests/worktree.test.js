const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const wt = require('../src/main/worktree.js');

const SLUG = /^[a-z0-9-]{1,32}$/;

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
}

// <tmp>/repo with one commit on main; worktrees land in <tmp>/.zonder-worktrees.
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-wt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  return { root, repo };
}

test('isGitRepo: plain dir is false, repo root is true, subfolder of a repo is false', async (t) => {
  const { root, repo } = makeRepo(t);
  const sub = path.join(repo, 'sub');
  fs.mkdirSync(sub);
  assert.equal(await wt.isGitRepo(root), false);
  assert.equal(await wt.isGitRepo(repo), true);
  assert.equal(await wt.isGitRepo(sub), false);
  assert.equal(await wt.isGitRepo(path.join(root, 'missing')), false);
});

test('listBranches lists local branches', async (t) => {
  const { repo } = makeRepo(t);
  git(repo, 'branch', 'feature/x');
  assert.deepEqual((await wt.listBranches(repo)).sort(), ['feature/x', 'main']);
});

test('makeSlug: reserved Windows name is prefixed', () => {
  const s = wt.makeSlug('CON', new Set());
  assert.match(s, SLUG);
  assert.notEqual(s, 'con');
  for (const name of ['nul', 'COM1', 'lpt9', 'Aux', 'prn']) {
    assert.ok(!['con', 'prn', 'aux', 'nul', 'com1', 'lpt9'].includes(wt.makeSlug(name, new Set())));
  }
});

test('makeSlug: traversal, accents, punctuation, spaces become a safe slug', () => {
  const s = wt.makeSlug('  ../Évil Name!! ', new Set());
  assert.match(s, SLUG);
  assert.equal(s, 'evil-name');
});

test('makeSlug: names with nothing usable still give a slug', () => {
  assert.match(wt.makeSlug('..', new Set()), SLUG);
  assert.match(wt.makeSlug('日本語', new Set()), SLUG);
});

test('makeSlug: taken slug gets a unique suffix, still within 32 chars', () => {
  const taken = new Set(['raka', 'raka-2']);
  assert.equal(wt.makeSlug('Raka', taken), 'raka-3');
  const long = 'x'.repeat(50);
  const first = wt.makeSlug(long, new Set());
  const second = wt.makeSlug(long, new Set([first]));
  assert.match(first, SLUG);
  assert.match(second, SLUG);
  assert.notEqual(first, second);
});

test('createWorktree: sibling .zonder-worktrees/<id> on zonder/<slug>-<shortid>; main checkout untouched', async (t) => {
  const { root, repo } = makeRepo(t);
  const headBefore = git(repo, 'rev-parse', 'HEAD');
  const res = await wt.createWorktree({ repo, baseBranch: 'main', name: 'Raka Dev', agentId: 'a1b2c3d4e5', taken: new Set() });
  assert.equal(res.path, path.join(root, '.zonder-worktrees', 'a1b2c3d4e5'));
  assert.equal(res.slug, 'raka-dev');
  assert.equal(res.branch, 'zonder/raka-dev-a1b2c3');
  assert.ok(fs.existsSync(path.join(res.path, 'README.md')));
  assert.equal(git(res.path, 'branch', '--show-current'), res.branch);
  assert.equal(git(repo, 'branch', '--show-current'), 'main');
  assert.equal(git(repo, 'rev-parse', 'HEAD'), headBefore);
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test('createWorktree rejects a base branch that does not exist', async (t) => {
  const { repo } = makeRepo(t);
  await assert.rejects(wt.createWorktree({ repo, baseBranch: '--orphan', name: 'x', agentId: 'abc123', taken: new Set() }), /base branch/);
});

test('createWorktree rejects an agent id that could escape the worktrees dir', async (t) => {
  const { repo } = makeRepo(t);
  await assert.rejects(wt.createWorktree({ repo, baseBranch: 'main', name: 'x', agentId: '..\\evil', taken: new Set() }), /agent id/);
});

test('removeWorktree with deleteBranch:false keeps the branch', async (t) => {
  const { repo } = makeRepo(t);
  const res = await wt.createWorktree({ repo, baseBranch: 'main', name: 'Keep', agentId: 'keep01', taken: new Set() });
  await wt.removeWorktree({ repo, path: res.path, branch: res.branch, deleteBranch: false });
  assert.equal(fs.existsSync(res.path), false);
  assert.ok((await wt.listBranches(repo)).includes(res.branch));
});

test('removeWorktree with deleteBranch:true deletes the branch', async (t) => {
  const { repo } = makeRepo(t);
  const res = await wt.createWorktree({ repo, baseBranch: 'main', name: 'Gone', agentId: 'gone01', taken: new Set() });
  fs.writeFileSync(path.join(res.path, 'new.txt'), 'x');
  git(res.path, 'add', '.');
  git(res.path, 'commit', '-q', '-m', 'unmerged work');
  await wt.removeWorktree({ repo, path: res.path, branch: res.branch, deleteBranch: true });
  assert.equal(fs.existsSync(res.path), false);
  assert.ok(!(await wt.listBranches(repo)).includes(res.branch));
});

test('dirty worktree: isDirty true, remove without force fails, with force succeeds', async (t) => {
  const { repo } = makeRepo(t);
  const res = await wt.createWorktree({ repo, baseBranch: 'main', name: 'Dirty', agentId: 'dirty1', taken: new Set() });
  assert.equal(await wt.isDirty(res.path), false);
  fs.writeFileSync(path.join(res.path, 'scratch.txt'), 'wip');
  assert.equal(await wt.isDirty(res.path), true);
  await assert.rejects(wt.removeWorktree({ repo, path: res.path, branch: res.branch, deleteBranch: false }));
  assert.ok(fs.existsSync(res.path));
  await wt.removeWorktree({ repo, path: res.path, branch: res.branch, deleteBranch: false, force: true });
  assert.equal(fs.existsSync(res.path), false);
});

test('removeWorktree refuses the main checkout and non-zonder branches', async (t) => {
  const { repo } = makeRepo(t);
  await assert.rejects(wt.removeWorktree({ repo, path: repo, branch: 'zonder/x-1', deleteBranch: false }), /outside/);
  const res = await wt.createWorktree({ repo, baseBranch: 'main', name: 'Guard', agentId: 'guard1', taken: new Set() });
  await assert.rejects(wt.removeWorktree({ repo, path: res.path, branch: 'main', deleteBranch: true }), /zonder\//);
  assert.ok(fs.existsSync(res.path));
  assert.ok((await wt.listBranches(repo)).includes('main'));
});

test('currentBranch names the checked-out branch, null when detached', async (t) => {
  const { repo } = makeRepo(t);
  assert.equal(await wt.currentBranch(repo), 'main');
  git(repo, 'checkout', '-q', '-b', 'feature/y');
  assert.equal(await wt.currentBranch(repo), 'feature/y');
  git(repo, 'checkout', '-q', '--detach');
  assert.equal(await wt.currentBranch(repo), null);
});

test('listAgentWorktrees lists only worktrees under .zonder-worktrees, with their branch', async (t) => {
  const { root, repo } = makeRepo(t);
  const res = await wt.createWorktree({ repo, baseBranch: 'main', name: 'Juni', agentId: 'zz9abc1', taken: new Set() });
  git(repo, 'worktree', 'add', '-q', '-b', 'side', path.join(root, 'elsewhere'), 'main');
  const list = await wt.listAgentWorktrees(repo);
  assert.equal(list.length, 1);
  assert.equal(list[0].path.toLowerCase(), path.resolve(res.path).toLowerCase());
  assert.equal(list[0].branch, res.branch);
  assert.equal(wt.exists(res.path), true);
  assert.equal(wt.exists(path.join(root, 'nope')), false);
});
