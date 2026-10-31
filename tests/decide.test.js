const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decide, ROLES } = require('../src/main/policy/decide.js');

// <tmp>/repo (main checkout), <tmp>/.zonder-worktrees/a1 (agent worktree), <tmp>/outside
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-decide-'));
const mainRepo = path.join(root, 'repo');
const wt = path.join(root, '.zonder-worktrees', 'a1');
fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
fs.mkdirSync(path.join(wt, 'tests'), { recursive: true });
fs.mkdirSync(mainRepo);
fs.mkdirSync(path.join(root, 'outside'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const ctx = (grants = []) => ({ worktree: wt, mainRepo, sessionGrants: new Set(grants) });
const sh = (command) => ({ kind: 'shell', tool: 'Bash', command });

const A = {
  read: { kind: 'read', tool: 'Read', path: path.join(wt, 'src', 'a.js') },
  write: { kind: 'write', tool: 'Write', path: path.join(wt, 'src', 'a.js') },
  writeTest: { kind: 'write', tool: 'Write', path: path.join(wt, 'tests', 'a.test.js') },
  deleteFile: { kind: 'delete', tool: 'Delete', path: path.join(wt, 'src', 'a.js') },
  shTest: sh('npm test'),
  shUnknown: sh('node script.js'),
  gitRead: sh('git status'),
  gitWrite: sh('git commit -m "wip"'),
  install: sh('npm install zod'),
  push: sh('git push'),
  shDelete: sh('rm src/a.js'),
  unknownTool: { kind: 'other', tool: 'mcp__srv__thing' },
};

// Spec §5. Columns follow the keys of A.
const TABLE = {
  'Senior Developer': ['allow', 'allow', 'allow', 'ask', 'allow', 'ask', 'allow', 'ask', 'ask', 'ask', 'ask', 'ask'],
  'Junior Developer': ['allow', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask'],
  Reviewer: ['allow', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'ask'],
  Researcher: ['allow', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'deny', 'ask'],
  'QA Engineer': ['allow', 'deny', 'ask', 'deny', 'allow', 'ask', 'allow', 'ask', 'ask', 'ask', 'ask', 'ask'],
  Custom: ['allow', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask', 'ask'],
};

test('table covers every role', () => {
  assert.deepEqual(Object.keys(TABLE).sort(), [...ROLES].sort());
});

for (const [role, verdicts] of Object.entries(TABLE)) {
  Object.keys(A).forEach((name, i) => {
    test(`${role} / ${name} -> ${verdicts[i]}`, () => {
      const d = decide(role, A[name], ctx());
      assert.equal(d.verdict, verdicts[i], d.reason);
      assert.equal(d.hard, false);
      assert.equal(typeof d.reason, 'string');
      assert.ok(d.reason.length > 0);
    });
  });
}

const HARD = {
  outsidePath: { kind: 'read', tool: 'Read', path: path.join(root, 'outside', 'x.txt') },
  traversal: { kind: 'write', tool: 'Write', path: path.join(wt, '..', '..', 'outside', 'x.txt') },
  mainRepoPath: { kind: 'read', tool: 'Read', path: path.join(mainRepo, 'README.md') },
  credentialRead: { kind: 'read', tool: 'Read', path: path.join(wt, '.env.local') },
  credentialWrite: { kind: 'write', tool: 'Write', path: path.join(wt, 'certs', 'server.key') },
  forcePush: sh('git push --force'),
  historyRewrite: sh('git reset --hard origin/main'),
  shellOutsidePath: sh(`rm -rf ${path.join(root, 'outside')}`),
  shellMainRepo: sh(`git diff ${mainRepo}`),
  shellCredential: sh('git add .env'),
  shellHome: sh('rm ~/notes.txt'),
};

for (const role of ROLES) {
  for (const [name, action] of Object.entries(HARD)) {
    test(`hard block: ${role} / ${name}`, () => {
      const d = decide(role, action, ctx());
      assert.equal(d.verdict, 'deny');
      assert.equal(d.hard, true);
      assert.equal(d.grantKey, undefined);
    });
  }
}

test('a session grant turns a matching ask into allow', () => {
  const first = decide('Junior Developer', A.write, ctx());
  assert.equal(first.verdict, 'ask');
  assert.ok(first.grantKey.startsWith('Write:'));
  const again = decide('Junior Developer', A.write, ctx([first.grantKey]));
  assert.equal(again.verdict, 'allow');
});

test('a grant for one path does not cover another', () => {
  const key = decide('Junior Developer', A.write, ctx()).grantKey;
  assert.equal(decide('Junior Developer', A.writeTest, ctx([key])).verdict, 'ask');
});

test('shell grant keys ignore extra whitespace', () => {
  const key = decide('Junior Developer', sh('node   script.js'), ctx()).grantKey;
  assert.equal(key, 'Bash:node script.js');
  assert.equal(decide('Junior Developer', A.shUnknown, ctx([key])).verdict, 'allow');
});

test('install, push, and delete always ask: no grant key, a forged grant does not help', () => {
  for (const name of ['install', 'push', 'shDelete', 'deleteFile']) {
    const d = decide('Senior Developer', A[name], ctx());
    assert.equal(d.verdict, 'ask', name);
    assert.equal(d.grantKey, undefined, name);
    const key = `${A[name].tool}:${A[name].command ?? path.resolve(A[name].path).toLowerCase()}`;
    assert.equal(decide('Senior Developer', A[name], ctx([key])).verdict, 'ask', name);
  }
});

test('a session grant never flips a hard block', () => {
  const key = `Read:${path.join(root, 'outside', 'x.txt').toLowerCase()}`;
  const d = decide('Senior Developer', HARD.outsidePath, ctx([key, 'Bash:git push --force']));
  assert.equal(d.verdict, 'deny');
  assert.equal(decide('Senior Developer', HARD.forcePush, ctx(['Bash:git push --force'])).verdict, 'deny');
});

test('read-only roles cannot be granted a write', () => {
  const key = `Write:${path.resolve(A.write.path).toLowerCase()}`;
  assert.equal(decide('Reviewer', A.write, ctx([key])).verdict, 'deny');
});

test('write or delete without a path is denied', () => {
  assert.equal(decide('Senior Developer', { kind: 'write', tool: 'Write' }, ctx()).verdict, 'deny');
  assert.equal(decide('Senior Developer', { kind: 'delete', tool: 'Delete' }, ctx()).verdict, 'deny');
});

test('read without a path means the worktree itself and is allowed', () => {
  assert.equal(decide('Reviewer', { kind: 'read', tool: 'Glob' }, ctx()).verdict, 'allow');
});

test('relative file paths resolve against the worktree, not the main checkout', () => {
  assert.equal(decide('Senior Developer', { kind: 'write', tool: 'Write', path: 'src/a.js' }, ctx()).verdict, 'allow');
  const d = decide('Senior Developer', { kind: 'read', tool: 'Read', path: '..\\..\\repo\\README.md' }, ctx());
  assert.equal(d.hard, true);
  assert.match(d.reason, /checkout utama/);
});

test('unknown role is denied', () => {
  assert.equal(decide('Intern', A.read, ctx()).verdict, 'deny');
});

test('quoted text with spaces is not mistaken for a path', () => {
  assert.equal(decide('Senior Developer', sh('git commit -m "docs: see ../readme"'), ctx()).verdict, 'ask');
});

test('URLs are not treated as paths', () => {
  assert.equal(decide('Senior Developer', sh('git push https://example.com/r.git'), ctx()).hard, false);
});
