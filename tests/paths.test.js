const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isInside, isCredentialPath } = require('../src/main/policy/paths.js');

// <tmp>/wt (worktree, with src/a.js), <tmp>/wt2 (prefix sibling), <tmp>/outside
function layout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const wt = path.join(root, 'wt');
  fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'src', 'a.js'), '');
  fs.mkdirSync(path.join(root, 'wt2'));
  fs.mkdirSync(path.join(root, 'outside'));
  return { root, wt };
}

test('inside: existing file, new file, worktree root itself', (t) => {
  const { wt } = layout(t);
  assert.equal(isInside(wt, path.join(wt, 'src', 'a.js')), true);
  assert.equal(isInside(wt, path.join(wt, 'src', 'new', 'b.js')), true);
  assert.equal(isInside(wt, wt), true);
});

test('relative candidates resolve against the worktree', (t) => {
  const { wt } = layout(t);
  assert.equal(isInside(wt, 'src/a.js'), true);
  assert.equal(isInside(wt, '..\\outside\\x'), false);
});

test('.. escaping the worktree is outside', (t) => {
  const { wt } = layout(t);
  assert.equal(isInside(wt, wt + '\\..\\x'), false);
  assert.equal(isInside(wt, wt + '\\src\\..\\..\\outside\\x'), false);
});

test('sibling dir sharing a prefix is outside', (t) => {
  const { root, wt } = layout(t);
  assert.equal(isInside(wt, path.join(root, 'wt2', 'x.js')), false);
});

test('other drive letter is outside', (t) => {
  const { wt } = layout(t);
  const drive = wt.slice(0, 1).toUpperCase();
  const other = drive === 'C' ? 'D' : 'C';
  assert.equal(isInside(wt, `${other}:\\x.js`), false);
  assert.equal(isInside(wt, `${other}:x.js`), false);
});

test('UNC and device paths are outside', (t) => {
  const { wt } = layout(t);
  assert.equal(isInside(wt, '\\\\srv\\share\\x'), false);
  assert.equal(isInside(wt, '//srv/share/x'), false);
  assert.equal(isInside(wt, '\\\\?\\' + path.join(wt, 'src', 'a.js')), false);
  assert.equal(isInside(wt, '\\\\.\\' + path.join(wt, 'src', 'a.js')), false);
});

test('alternate data streams are refused', (t) => {
  const { wt } = layout(t);
  assert.equal(isInside(wt, path.join(wt, 'src', 'a.js:hidden')), false);
});

test('junction inside the worktree pointing outside is outside', (t) => {
  const { root, wt } = layout(t);
  fs.symlinkSync(path.join(root, 'outside'), path.join(wt, 'link'), 'junction');
  assert.equal(isInside(wt, path.join(wt, 'link', 'x.js')), false);
  assert.equal(isInside(wt, path.join(wt, 'link')), false);
});

test('forward-slash and upper-case variants of an inside path are inside', (t) => {
  const { wt } = layout(t);
  assert.equal(isInside(wt, path.join(wt, 'src', 'a.js').replace(/\\/g, '/')), true);
  assert.equal(isInside(wt, path.join(wt, 'SRC', 'A.JS').toUpperCase()), true);
  assert.equal(isInside(wt.toUpperCase(), path.join(wt, 'src', 'a.js')), true);
});

test('8.3 short name of an inside path is inside', (t) => {
  const { wt } = layout(t);
  const long = path.join(wt, 'a-rather-long-folder-name');
  fs.mkdirSync(long);
  const short = execFileSync('cmd.exe', ['/d', '/c', `for %I in ("${long}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true }).trim();
  if (short.toLowerCase() === long.toLowerCase()) return t.skip('8.3 names disabled on this volume');
  assert.equal(isInside(wt, path.join(short, 'x.js')), true);
});

test('credential paths', () => {
  for (const p of ['.env', '.env.local', 'app/.env.production', 'certs/server.pem', 'tls.key', 'C:\\Users\\me\\.ssh\\id_rsa', 'id_rsa.pub',
    '.npmrc', '.git-credentials', 'credentials.json', 'config/credentials', 'C:/Users/me/.aws/config', 'home/.ssh/known_hosts']) {
    assert.equal(isCredentialPath(p), true, p);
  }
  for (const p of ['src/env.js', 'README.md', 'keyboard.js', 'src/monkey.ts', 'docs/environment.md']) {
    assert.equal(isCredentialPath(p), false, p);
  }
});
