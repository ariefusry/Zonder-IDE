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

// Changes panel (layout Task 24): what an agent changed against its base branch.

test('parseNameStatus handles M, A, D, R100 with oldPath, a path with spaces, and a non-ASCII name', () => {
  const out = wt.parseNameStatus('M\0a.txt\0A\0dir/b c.txt\0D\0gone.txt\0R100\0old.txt\0new.txt\0M\0kopi ü.txt\0T\0link\0C075\0src.txt\0copy.txt\0');
  assert.deepEqual(out, [
    { path: 'a.txt', status: 'M' },
    { path: 'dir/b c.txt', status: 'A' },
    { path: 'gone.txt', status: 'D' },
    { path: 'new.txt', status: 'R', oldPath: 'old.txt' },
    { path: 'kopi ü.txt', status: 'M' },
    { path: 'link', status: 'M' },
    { path: 'copy.txt', status: 'A' },
  ]);
  assert.deepEqual(wt.parseNameStatus(''), []);
});

// Repo with tracked files on main and an agent worktree on its own branch.
async function changesRepo(t, baseBranch = 'main') {
  const { root, repo } = makeRepo(t);
  const lines = Array.from({ length: 20 }, (_, i) => `baris ${i}`).join('\n') + '\n';
  for (const f of ['a.txt', 'del.txt', 'same.txt', 'old.txt']) fs.writeFileSync(path.join(repo, f), `${f}\n${lines}`);
  fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'files');
  if (baseBranch !== 'main') git(repo, 'branch', baseBranch);
  const tree = await wt.createWorktree({ repo, baseBranch, name: 'Raka', agentId: 'agent01', taken: new Set() });
  return { root, repo, wt: tree.path };
}

test('listChanges counts a committed edit, an uncommitted edit, a deleted file, a rename, and an untracked file; ignored files and unchanged files are absent', async (t) => {
  const { wt: w } = await changesRepo(t);
  fs.appendFileSync(path.join(w, 'a.txt'), 'commit\n');
  git(w, 'commit', '-q', '-am', 'edit a');
  git(w, 'mv', 'old.txt', 'new name.txt');
  git(w, 'commit', '-q', '-m', 'rename');
  fs.appendFileSync(path.join(w, 'README.md'), 'belum commit\n');
  fs.rmSync(path.join(w, 'del.txt'));
  fs.writeFileSync(path.join(w, 'baru ü.txt'), 'x\n');
  fs.writeFileSync(path.join(w, 'debug.log'), 'abaikan\n');
  const r = await wt.listChanges(w, 'main');
  assert.match(r.base, /^[0-9a-f]{40}$/);
  assert.deepEqual(r.files, [
    { path: 'README.md', status: 'M' },
    { path: 'a.txt', status: 'M' },
    { path: 'baru ü.txt', status: 'A' },
    { path: 'del.txt', status: 'D' },
    { path: 'new name.txt', status: 'R', oldPath: 'old.txt' },
  ]);
});

test('listChanges with no changes -> files []', async (t) => {
  const { wt: w } = await changesRepo(t);
  assert.deepEqual((await wt.listChanges(w, 'main')).files, []);
});

test('listChanges after the base branch is deleted -> throws with git\'s message', async (t) => {
  const { repo, wt: w } = await changesRepo(t, 'dev');
  git(repo, 'branch', '-D', 'dev');
  await assert.rejects(wt.listChanges(w, 'dev'), /git merge-base failed: .+/);
});

test('fileDiff of an untracked file shows every line with +; of a binary -> binary true, text \'\'; of a 300 KB change -> truncated true, text <= 200 KB', async (t) => {
  const { wt: w } = await changesRepo(t);
  fs.writeFileSync(path.join(w, 'n ü.txt'), 'satu\ndua\n');
  fs.writeFileSync(path.join(w, 'b.bin'), Buffer.from([0, 1, 2, 0, 255, 0]));
  fs.writeFileSync(path.join(w, 'big.txt'), 'x'.repeat(99) + '\n'.repeat(1) + Array.from({ length: 3000 }, (_, i) => `${i} ${'y'.repeat(95)}`).join('\n') + '\n');
  fs.appendFileSync(path.join(w, 'a.txt'), 'tambah\n');
  const { base } = await wt.listChanges(w, 'main');

  const u = await wt.fileDiff(w, base, 'n ü.txt');
  assert.equal(u.path, 'n ü.txt');
  assert.equal(u.binary, false);
  assert.equal(u.truncated, false);
  const body = u.text.split('\n').slice(u.text.split('\n').findIndex((l) => l.startsWith('@@')) + 1).filter(Boolean);
  assert.deepEqual(body, ['+satu', '+dua']);

  const m = await wt.fileDiff(w, base, 'a.txt');
  assert.match(m.text, /^\+tambah$/m);

  const b = await wt.fileDiff(w, base, 'b.bin');
  assert.deepEqual([b.binary, b.text], [true, '']);

  const big = await wt.fileDiff(w, base, 'big.txt');
  assert.equal(big.truncated, true);
  assert.ok(Buffer.byteLength(big.text) <= wt.MAX_DIFF, 'within 200 KB');
  assert.ok(Buffer.byteLength(big.text) > 100 * 1024, 'keeps most of it');
  assert.equal(wt.MAX_DIFF, 200 * 1024);
});

test('removeWorktree on a folder deleted from outside prunes the worktree and deletes the branch', async (t) => {
  const { repo } = makeRepo(t);
  const res = await wt.createWorktree({ repo, baseBranch: 'main', name: 'Hilang', agentId: 'lost01', taken: new Set() });
  fs.rmSync(res.path, { recursive: true, force: true });
  await wt.removeWorktree({ repo, path: res.path, branch: res.branch, deleteBranch: true });
  assert.ok(!(await wt.listBranches(repo)).includes(res.branch));
  assert.equal((await wt.listAgentWorktrees(repo)).length, 0);
});
