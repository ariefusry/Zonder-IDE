// Claude Code CLI status for Settings → Providers (settings plan Task 15).
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkClaude } = require('../src/main/claude-status.js');

// execFile(file, args, opts, cb) fake: answers by the first argument.
function fakeExec(answers) {
  const calls = [];
  const execFile = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    const a = answers[args[0]];
    setImmediate(() => {
      if (!a) return cb(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), '', '');
      if (a.error) return cb(a.error, '', '');
      cb(null, a.stdout ?? '', '');
    });
    return { kill() {} };
  };
  return { execFile, calls };
}

const EXE = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
const loggedIn = { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'someone@example.com', orgName: 'Org' }) };

test('"2.1.316 (Claude Code)" -> installed, version 2.1.316, logged in', async () => {
  const f = fakeExec({ '--version': { stdout: '2.1.316 (Claude Code)\n' }, auth: loggedIn });
  const r = await checkClaude({ execFile: f.execFile, resolveExe: () => EXE });
  assert.deepEqual(r, { installed: true, version: '2.1.316', loggedIn: true, error: null });
});

test('the result carries no account details from auth status', async () => {
  const f = fakeExec({ '--version': { stdout: '2.1.316 (Claude Code)' }, auth: loggedIn });
  const r = await checkClaude({ execFile: f.execFile, resolveExe: () => EXE });
  assert.doesNotMatch(JSON.stringify(r), /example\.com|Org/);
});

test('no claude.exe on PATH -> not installed, nothing run', async () => {
  const f = fakeExec({});
  const r = await checkClaude({ execFile: f.execFile, resolveExe: () => null });
  assert.deepEqual(r, { installed: false, version: null, loggedIn: null, error: 'Claude Code CLI tidak ditemukan.' });
  assert.equal(f.calls.length, 0);
});

test('ENOENT from --version -> not installed', async () => {
  const f = fakeExec({});
  const r = await checkClaude({ execFile: f.execFile, resolveExe: () => EXE });
  assert.equal(r.installed, false);
  assert.equal(r.error, 'Claude Code CLI tidak ditemukan.');
});

test('the login check only runs "auth status --json", never a login command, with a timeout', async () => {
  const f = fakeExec({ '--version': { stdout: '2.1.316 (Claude Code)' }, auth: { stdout: '{"loggedIn":false}' } });
  const r = await checkClaude({ execFile: f.execFile, resolveExe: () => EXE });
  assert.equal(r.loggedIn, false);
  assert.deepEqual(f.calls.map((c) => c.args), [['--version'], ['auth', 'status', '--json']]);
  for (const c of f.calls) {
    assert.equal(c.file, EXE);
    assert.equal(c.opts.timeout, 10000);
    assert.equal(c.opts.windowsHide, true);
    assert.ok(!c.args.includes('login'));
  }
});

test('auth status that fails or prints non-JSON -> loggedIn null, still installed', async () => {
  for (const auth of [{ error: Object.assign(new Error('timeout'), { killed: true }) }, { stdout: 'not json' }]) {
    const f = fakeExec({ '--version': { stdout: '2.1.316 (Claude Code)' }, auth });
    const r = await checkClaude({ execFile: f.execFile, resolveExe: () => EXE });
    assert.equal(r.installed, true);
    assert.equal(r.loggedIn, null);
  }
});

test('preload exposes claudeStatus on a known channel and no raw ipcRenderer', () => {
  const Module = require('node:module');
  const { CHANNELS } = require('../src/main/ipc.js');
  let api = null;
  const invoked = [];
  const fake = {
    contextBridge: { exposeInMainWorld: (_name, obj) => { api = obj; } },
    ipcRenderer: { invoke: (ch) => invoked.push(ch), on() {}, removeListener() {} },
  };
  const load = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? fake : load.call(this, req, ...rest); };
  try {
    delete require.cache[require.resolve('../src/preload/preload.js')];
    require('../src/preload/preload.js');
  } finally {
    Module._load = load;
  }
  assert.equal(typeof api.claudeStatus, 'function');
  assert.equal(api.ipcRenderer, undefined);
  api.claudeStatus();
  assert.deepEqual(invoked, [CHANNELS.claudeStatus]);
  // Every invoke channel in preload exists in main's CHANNELS.
  for (const [name, fn] of Object.entries(api)) {
    if (name === 'subscribeAgentEvents') continue;
    invoked.length = 0;
    try { fn('x', 'y', 'z'); } catch {}
    assert.ok(Object.values(CHANNELS).includes(invoked[0]), name);
  }
});
