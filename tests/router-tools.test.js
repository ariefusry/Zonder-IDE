const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TOOLS, toAction, execTool, OUTPUT_CAP } = require('../src/main/agents/router-tools.js');

function tmpWorktree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-rt-'));
  const wt = path.join(root, 'wt');
  fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'src', 'a.txt'), 'isi a');
  return { root, wt, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('TOOLS are OpenAI function schemas for the four tools', () => {
  assert.deepEqual(TOOLS.map((t) => t.function.name), ['read_file', 'list_dir', 'write_file', 'run_command']);
  for (const t of TOOLS) {
    assert.equal(t.type, 'function');
    assert.equal(t.function.parameters.type, 'object');
  }
});

test('toAction maps each tool to a policy action', () => {
  assert.deepEqual(toAction('read_file', { path: 'a.txt' }), { kind: 'read', tool: 'read_file', path: 'a.txt', summary: 'a.txt' });
  assert.deepEqual(toAction('list_dir', {}), { kind: 'read', tool: 'list_dir', path: '.', summary: '.' });
  assert.deepEqual(toAction('write_file', { path: 'b.txt', content: 'x' }), { kind: 'write', tool: 'write_file', path: 'b.txt', summary: 'b.txt' });
  assert.deepEqual(toAction('run_command', { command: 'npm test' }), { kind: 'shell', tool: 'run_command', command: 'npm test', summary: 'npm test' });
});

test('toAction rejects missing or non-string arguments instead of letting decide allow them', () => {
  assert.equal(toAction('read_file', {}), null);
  assert.equal(toAction('read_file', { path: 7 }), null);
  assert.equal(toAction('write_file', { path: 'a' }), null);
  assert.equal(toAction('run_command', { command: '' }), null);
  assert.equal(toAction('list_dir', { path: ['x'] }), null);
  assert.equal(toAction('read_file', null), null);
  assert.equal(toAction('nope', {}), null);
});

test('read_file, list_dir and write_file work inside the worktree', async () => {
  const t = tmpWorktree();
  try {
    const ctx = { worktree: t.wt };
    assert.equal(await execTool('read_file', { path: 'src/a.txt' }, ctx), 'isi a');
    assert.equal(await execTool('list_dir', { path: '.' }, ctx), 'src/');
    assert.equal(await execTool('list_dir', { path: 'src' }, ctx), 'a.txt');
    assert.match(await execTool('write_file', { path: 'new/b.txt', content: 'hai' }, ctx), /new[\\/]b\.txt/);
    assert.equal(fs.readFileSync(path.join(t.wt, 'new', 'b.txt'), 'utf8'), 'hai');
  } finally {
    t.cleanup();
  }
});

test('execTool refuses paths outside the worktree and credential files on its own', async () => {
  const t = tmpWorktree();
  try {
    const ctx = { worktree: t.wt };
    await assert.rejects(execTool('write_file', { path: '..\\x', content: 'no' }, ctx), /luar worktree/);
    assert.equal(fs.existsSync(path.join(t.root, 'x')), false);
    await assert.rejects(execTool('read_file', { path: path.join(t.root, 'other.txt') }, ctx), /luar worktree/);
    await assert.rejects(execTool('read_file', { path: '.env' }, ctx), /kredensial/);
  } finally {
    t.cleanup();
  }
});

test('read_file output is capped', async () => {
  const t = tmpWorktree();
  try {
    fs.writeFileSync(path.join(t.wt, 'big.txt'), 'x'.repeat(OUTPUT_CAP + 500));
    const out = await execTool('read_file', { path: 'big.txt' }, { worktree: t.wt });
    assert.ok(out.length < OUTPUT_CAP + 100);
    assert.match(out, /dipotong/);
  } finally {
    t.cleanup();
  }
});

test('run_command runs cmd.exe /d /s /c verbatim in the worktree with a timeout', async () => {
  const calls = [];
  const execFile = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    cb(null, 'out\n', 'err\n');
    return { pid: 1 };
  };
  const out = await execTool('run_command', { command: 'echo "a & b"' }, { worktree: 'C:\\wt', execFile });
  assert.equal(calls[0].file, 'cmd.exe');
  assert.deepEqual(calls[0].args, ['/d', '/s', '/c', '"echo "a & b""']);
  assert.equal(calls[0].opts.cwd, 'C:\\wt');
  assert.equal(calls[0].opts.windowsVerbatimArguments, true);
  assert.equal(calls[0].opts.windowsHide, true);
  assert.ok(calls[0].opts.maxBuffer > OUTPUT_CAP);
  assert.match(out, /out/);
  assert.match(out, /err/);
});

test('run_command reports a non-zero exit code and kills the tree on timeout', async () => {
  const killed = [];
  const fail = (_f, _a, _o, cb) => {
    const err = Object.assign(new Error('Command failed'), { code: 2 });
    cb(err, 'partial', 'boom');
    return { pid: 7 };
  };
  assert.match(await execTool('run_command', { command: 'npm test' }, { worktree: 'C:\\wt', execFile: fail }), /kode keluar 2/);

  const hang = () => ({ pid: 99 });
  const out = await execTool('run_command', { command: 'npm test' }, { worktree: 'C:\\wt', execFile: hang, timeoutMs: 20, kill: async (pid) => killed.push(pid) });
  assert.deepEqual(killed, [99]);
  assert.match(out, /dihentikan setelah/);
});

test('run_command: an abort kills the tree at once and says so', async () => {
  const killed = [];
  const ctrl = new AbortController();
  const hang = () => ({ pid: 55 });
  const running = execTool('run_command', { command: 'npm test' }, { worktree: 'C:\\wt', execFile: hang, signal: ctrl.signal, kill: async (pid) => killed.push(pid) });
  ctrl.abort();
  assert.match(await running, /Dibatalkan/);
  assert.deepEqual(killed, [55]);
  let ran = false;
  assert.match(await execTool('run_command', { command: 'npm test' }, { worktree: 'C:\\wt', signal: ctrl.signal, execFile: () => { ran = true; } }), /Dibatalkan/);
  assert.equal(ran, false);
});

test('run_command for real: output comes back from cmd.exe', { skip: process.platform !== 'win32' }, async () => {
  const t = tmpWorktree();
  try {
    const out = await execTool('run_command', { command: 'dir /b src' }, { worktree: t.wt });
    assert.match(out, /a\.txt/);
  } finally {
    t.cleanup();
  }
});

// load_skill (settings plan Task 17): read-only, no decide, only the role's skills.
function skillFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-rts-'));
  const dir = path.join(root, 'ui');
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: ui\ndescription: Aturan UI.\n---\nSatu aksen saja.');
  fs.writeFileSync(path.join(dir, 'references', 'a.md'), 'referensi a');
  const skills = [{ id: 'user:ui', name: 'ui', description: 'Aturan UI.', source: 'user', dir }];
  return { skills, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('toolsFor adds load_skill only when the role has skills', () => {
  const { toolsFor } = require('../src/main/agents/router-tools.js');
  assert.deepEqual(toolsFor({ skills: [] }).map((t) => t.function.name), ['read_file', 'list_dir', 'write_file', 'run_command']);
  assert.deepEqual(toolsFor(null).map((t) => t.function.name), ['read_file', 'list_dir', 'write_file', 'run_command']);
  assert.deepEqual(toolsFor({ skills: ['user:ui'] }).map((t) => t.function.name), ['read_file', 'list_dir', 'write_file', 'run_command', 'load_skill']);
});

test('load_skill reads a skill of the role by name or id, with an optional relative path', () => {
  const { loadSkill } = require('../src/main/agents/router-tools.js');
  const f = skillFixture();
  try {
    assert.match(loadSkill({ name: 'ui' }, { allowed: ['user:ui'], skills: f.skills }), /Satu aksen saja\./);
    assert.match(loadSkill({ name: 'user:ui' }, { allowed: ['user:ui'], skills: f.skills }), /Satu aksen saja\./);
    assert.equal(loadSkill({ name: 'ui', path: 'references/a.md' }, { allowed: ['user:ui'], skills: f.skills }), 'referensi a');
  } finally {
    f.cleanup();
  }
});

test('load_skill for a skill not in rolePolicy.skills -> tool result "Skill tidak tersedia untuk peran ini."', () => {
  const { loadSkill } = require('../src/main/agents/router-tools.js');
  const f = skillFixture();
  try {
    assert.equal(loadSkill({ name: 'ui' }, { allowed: [], skills: f.skills }), 'Skill tidak tersedia untuk peran ini.');
    assert.equal(loadSkill({ name: 'lain' }, { allowed: ['user:ui'], skills: f.skills }), 'Skill tidak tersedia untuk peran ini.');
  } finally {
    f.cleanup();
  }
});

test('load_skill path escape -> tool result with the refusal, no throw', () => {
  const { loadSkill } = require('../src/main/agents/router-tools.js');
  const f = skillFixture();
  try {
    assert.match(loadSkill({ name: 'ui', path: '../../x' }, { allowed: ['user:ui'], skills: f.skills }), /^Ditolak: .*di luar folder skill/);
    assert.match(loadSkill({ name: 'ui', path: 'C:\\Windows\\win.ini' }, { allowed: ['user:ui'], skills: f.skills }), /^Ditolak: .*relatif/);
    assert.match(loadSkill({}, { allowed: ['user:ui'], skills: f.skills }), /^invalid arguments/);
  } finally {
    f.cleanup();
  }
});
