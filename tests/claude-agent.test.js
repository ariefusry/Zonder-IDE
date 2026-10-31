const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { AgentStore } = require('../src/main/store.js');
const { ClaudeAgent, buildArgs, resolveClaudeExe, killTree } = require('../src/main/agents/claude-agent.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'claude', `${name}.jsonl`), 'utf8').trim().split('\n')[0];

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.writes = [];
  child.stdin.on('data', (d) => child.writes.push(d.toString()));
  child.exitCode = null;
  child.exit = (code) => {
    child.exitCode = code;
    child.emit('exit', code, null);
  };
  return child;
}

const tick = () => new Promise((r) => setImmediate(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(opts = {}) {
  const store = new AgentStore();
  const record = store.add({ id: 'agent1', name: 'Raka', model: 'haiku', persona: '', worktreePath: 'C:\\wt', status: 'stopped', ...opts.record });
  const events = [];
  store.subscribe((e) => events.push(e));
  const persisted = [];
  const persistence = { appendEvent: (id, e) => persisted.push({ id, ...e }) };
  const approvals = [];
  const child = fakeChild();
  const spawned = [];
  const killed = [];
  const agent = new ClaudeAgent({
    record,
    store,
    persistence,
    onApproval: (req) => approvals.push(req),
    spawn: (exe, args, options) => {
      spawned.push({ exe, args, options });
      return child;
    },
    kill: async (pid) => {
      killed.push(pid);
      child.exit(1);
    },
    resolveExe: () => 'C:\\bin\\claude.exe',
    doneIdleMs: 30,
    startQuietMs: 20,
    ...opts.agent,
  });
  const line = async (text) => {
    child.stdout.write(`${text}\n`);
    await tick();
  };
  return { store, record, events, persisted, approvals, child, spawned, killed, agent, line };
}

async function started(opts) {
  const s = setup(opts);
  await s.agent.start();
  await s.line(fixture('init'));
  return s;
}

const parse = (w) => JSON.parse(w);

test('buildArgs: stream-json, manual permissions over stdio, no MCP, settings rules, model', () => {
  const args = buildArgs({ model: 'haiku', persona: '' });
  for (const flag of ['-p', '--verbose', '--strict-mcp-config']) assert.ok(args.includes(flag), flag);
  const val = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(val('--input-format'), 'stream-json');
  assert.equal(val('--output-format'), 'stream-json');
  assert.equal(val('--permission-mode'), 'manual');
  assert.equal(val('--permission-prompt-tool'), 'stdio');
  assert.equal(val('--model'), 'haiku');
  const settings = JSON.parse(val('--settings'));
  assert.deepEqual(settings.permissions.ask, ['Read', 'Glob', 'Grep']);
  assert.ok(settings.permissions.deny.includes('Read(**/.env*)'));
  assert.ok(!args.includes('--append-system-prompt'));
  assert.ok(!args.includes('--resume'));
  assert.ok(!args.some((a) => /dangerously/.test(a)));
});

test('buildArgs: persona passed verbatim as one argument, resume when a session exists', () => {
  const persona = 'Marker: ZQ " & % ^ | < > end\nLine2';
  const args = buildArgs({ model: 'sonnet', persona, sessionId: 'abc-123' });
  assert.equal(args[args.indexOf('--append-system-prompt') + 1], persona);
  assert.equal(args[args.indexOf('--resume') + 1], 'abc-123');
});

test('resolveClaudeExe finds the npm-installed exe or a plain claude.exe on PATH', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-exe-'));
  try {
    const npmDir = path.join(base, 'npm');
    const npmExe = path.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    fs.mkdirSync(path.dirname(npmExe), { recursive: true });
    fs.writeFileSync(npmExe, '');
    const plainDir = path.join(base, 'plain');
    fs.mkdirSync(plainDir);
    fs.writeFileSync(path.join(plainDir, 'claude.exe'), '');
    const empty = path.join(base, 'empty');
    fs.mkdirSync(empty);

    assert.equal(resolveClaudeExe([empty, npmDir, plainDir].join(path.delimiter)), npmExe);
    assert.equal(resolveClaudeExe([empty, plainDir].join(path.delimiter)), path.join(plainDir, 'claude.exe'));
    assert.equal(resolveClaudeExe(empty), null);
    assert.equal(resolveClaudeExe(''), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('killTree runs taskkill on the whole tree, forced', async () => {
  const calls = [];
  await killTree(77, (file, args, cb) => {
    calls.push({ file, args });
    cb(null);
  });
  assert.deepEqual(calls, [{ file: 'taskkill', args: ['/pid', '77', '/T', '/F'] }]);
});

test('start spawns the exe in the worktree, hidden, and goes starting -> idle on first output', async () => {
  const s = setup();
  await s.agent.start();
  assert.equal(s.record.status, 'starting');
  assert.equal(s.spawned[0].exe, 'C:\\bin\\claude.exe');
  assert.equal(s.spawned[0].options.cwd, 'C:\\wt');
  assert.equal(s.spawned[0].options.windowsHide, true);
  assert.equal(s.spawned[0].options.shell, undefined);
  await s.line(fixture('init'));
  assert.equal(s.record.status, 'idle');
  assert.equal(s.record.sessionId, 'ef6d033a-2ef2-4ba5-b93d-edabdca54057');
  assert.ok(!s.events.some((e) => e.type === 'session'), 'session is internal');
});

test('start goes idle after a quiet period when the CLI prints nothing', async () => {
  const s = setup();
  await s.agent.start();
  await wait(50);
  assert.equal(s.record.status, 'idle');
});

test('start without a claude exe reports an error and spawns nothing', async () => {
  const s = setup({ agent: { resolveExe: () => null } });
  await s.agent.start();
  assert.equal(s.spawned.length, 0);
  assert.equal(s.record.status, 'error');
  assert.match(s.events.find((e) => e.type === 'error').message, /claude/i);
});

test('send writes one stream-json user line, records the message and sets thinking', async () => {
  const s = await started();
  s.agent.send('hai " & %\nbaris dua');
  await tick();
  assert.equal(s.child.writes.length, 1);
  assert.ok(s.child.writes[0].endsWith('\n'));
  assert.deepEqual(parse(s.child.writes[0]), { type: 'user', message: { role: 'user', content: 'hai " & %\nbaris dua' } });
  assert.equal(s.record.status, 'thinking');
  const msg = s.events.find((e) => e.type === 'message');
  assert.equal(msg.agentId, 'agent1');
  assert.equal(msg.role, 'user');
  assert.equal(msg.queued, false);
  assert.equal(typeof msg.ts, 'number');
  assert.equal(s.persisted[0].type, 'message');
});

test('send rejects empty text and an agent that is not running', async () => {
  const s = await started();
  assert.throws(() => s.agent.send('   '), /kosong/);
  assert.throws(() => s.agent.send(42), /kosong/);
  const t = setup();
  assert.throws(() => t.agent.send('hi'), /belum berjalan/);
});

test('messages sent mid-turn are queued and flushed one at a time on result', async () => {
  const s = await started();
  s.agent.send('satu');
  s.agent.send('dua');
  s.agent.send('tiga');
  await tick();
  assert.equal(s.child.writes.length, 1);
  assert.deepEqual(s.events.filter((e) => e.type === 'message').map((e) => e.queued), [false, true, true]);
  await s.line(fixture('result_success'));
  await tick();
  assert.equal(s.child.writes.length, 2);
  assert.equal(parse(s.child.writes[1]).message.content, 'dua');
  assert.equal(s.record.status, 'thinking');
  await s.line(fixture('result_success'));
  await tick();
  assert.equal(parse(s.child.writes[2]).message.content, 'tiga');
  await s.line(fixture('result_success'));
  await tick();
  assert.equal(s.child.writes.length, 3);
  assert.equal(s.record.status, 'done');
});

test('stdout lines split across chunks and CRLF endings parse correctly', async () => {
  const s = await started();
  s.agent.send('x');
  const text = fixture('text');
  s.child.stdout.write(text.slice(0, 25));
  await tick();
  assert.ok(!s.events.some((e) => e.type === 'message' && e.role === 'agent'));
  s.child.stdout.write(`${text.slice(25)}\r\n${fixture('tool_use_write')}`);
  await tick();
  assert.equal(s.events.filter((e) => e.role === 'agent').length, 1);
  s.child.stdout.write('\n');
  await tick();
  assert.ok(s.events.some((e) => e.type === 'tool_start'));
  assert.equal(s.record.status, 'working');
});

test('garbage and illegal transitions on stdout do not crash the agent', async () => {
  const s = await started();
  await s.line('not json {');
  await s.line(fixture('result_success')); // idle -> done is not a legal transition
  s.agent.send('masih hidup');
  await tick();
  assert.equal(s.child.writes.length, 1);
});

test('tool events are forwarded with agentId and persisted', async () => {
  const s = await started();
  s.agent.send('tulis');
  await s.line(fixture('tool_use_write'));
  await s.line(fixture('tool_result'));
  const types = s.persisted.map((e) => e.type);
  assert.deepEqual(types, ['message', 'tool_start', 'tool_end']);
  assert.ok(s.events.filter((e) => e.type.startsWith('tool_')).every((e) => e.agentId === 'agent1'));
});

test('can_use_tool calls onApproval; respond writes the exact allow/deny control_response once', async () => {
  const s = await started();
  s.agent.send('tulis');
  await s.line(fixture('control_can_use_tool'));
  assert.deepEqual(s.approvals, [{ agentId: 'agent1', requestId: 'b9534983-e655-4fe8-b3da-f55f7ab27d66', tool: 'Write', toolUseId: 'toolu_01ALV23PorFWnmzCFCAY5dMq', input: { file_path: 'C:\\wt\\hello.txt', content: 'hi' } }]);
  s.agent.respond('b9534983-e655-4fe8-b3da-f55f7ab27d66', 'allow');
  s.agent.respond('b9534983-e655-4fe8-b3da-f55f7ab27d66', 'deny');
  s.agent.respond('unknown', 'allow');
  await tick();
  assert.equal(s.child.writes.length, 2);
  assert.deepEqual(parse(s.child.writes[1]), {
    type: 'control_response',
    response: { subtype: 'success', request_id: 'b9534983-e655-4fe8-b3da-f55f7ab27d66', response: { behavior: 'allow', updatedInput: { file_path: 'C:\\wt\\hello.txt', content: 'hi' } } },
  });
});

test('deny carries the reason message; a changed input is echoed on allow', async () => {
  const s = await started();
  s.agent.send('tulis');
  await s.line(fixture('control_can_use_tool'));
  s.agent.respond('b9534983-e655-4fe8-b3da-f55f7ab27d66', 'deny', undefined, 'Ditolak: di luar worktree.');
  await tick();
  assert.deepEqual(parse(s.child.writes[1]).response.response, { behavior: 'deny', message: 'Ditolak: di luar worktree.' });

  const t = await started();
  t.agent.send('tulis');
  await t.line(fixture('control_can_use_tool'));
  t.agent.respond('b9534983-e655-4fe8-b3da-f55f7ab27d66', 'allow', { file_path: 'C:\\wt\\other.txt', content: 'hi' });
  await tick();
  assert.equal(parse(t.child.writes[1]).response.response.updatedInput.file_path, 'C:\\wt\\other.txt');
});

test('pending approvals are dropped when the turn ends', async () => {
  const s = await started();
  s.agent.send('tulis');
  await s.line(fixture('control_can_use_tool'));
  await s.line(fixture('result_interrupted'));
  s.agent.respond('b9534983-e655-4fe8-b3da-f55f7ab27d66', 'allow');
  await tick();
  assert.equal(s.child.writes.length, 1);
  assert.equal(s.record.status, 'idle');
});

test('interrupt writes the interrupt control_request; the interrupted turn returns to idle', async () => {
  const s = await started();
  s.agent.send('lama');
  s.agent.interrupt();
  await tick();
  const req = parse(s.child.writes[1]);
  assert.equal(req.type, 'control_request');
  assert.deepEqual(req.request, { subtype: 'interrupt' });
  assert.match(req.request_id, /^zonder-int-\d+$/);
  await s.line(fixture('control_response_interrupt'));
  await s.line(fixture('result_interrupted'));
  assert.equal(s.record.status, 'idle');
});

test('interrupt with no turn running writes nothing', async () => {
  const s = await started();
  s.agent.interrupt();
  await tick();
  assert.equal(s.child.writes.length, 0);
});

test('done returns to idle after doneIdleMs, unless a new turn started', async () => {
  const s = await started();
  s.agent.send('a');
  await s.line(fixture('result_success'));
  assert.equal(s.record.status, 'done');
  await wait(50);
  assert.equal(s.record.status, 'idle');

  s.agent.send('b');
  await s.line(fixture('result_success'));
  s.agent.send('c');
  await wait(50);
  assert.equal(s.record.status, 'thinking');
});

test('unexpected exit: exit event, stderr tail without hook noise, queued messages reported, status error', async () => {
  const s = await started();
  s.agent.send('satu');
  s.agent.send('antri');
  s.child.stderr.write('SessionEnd hook [http://localhost:47821/hook] failed: connect ECONNREFUSED\nFatal: out of memory\n');
  await tick();
  s.child.exit(3);
  await tick();
  assert.equal(s.record.status, 'error');
  const exit = s.events.find((e) => e.type === 'exit');
  assert.equal(exit.code, 3);
  const errors = s.events.filter((e) => e.type === 'error').map((e) => e.message);
  assert.ok(errors.some((m) => /out of memory/.test(m) && !/localhost/.test(m)), errors.join(' | '));
  assert.ok(errors.some((m) => /antri/.test(m) && /tidak terkirim/.test(m)), errors.join(' | '));
  assert.ok(s.persisted.some((e) => e.type === 'exit'));
  assert.throws(() => s.agent.send('lagi'), /belum berjalan/);
});

test('a spawn error (exe vanished) ends in error, not a crash', async () => {
  const s = await started();
  s.child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
  s.child.exit(-4058);
  await tick();
  assert.equal(s.record.status, 'error');
});

test('stop kills the process tree and ends stopped without an exit event', async () => {
  const s = await started();
  s.agent.send('kerja');
  s.agent.send('antri');
  await s.agent.stop();
  assert.deepEqual(s.killed, [4242]);
  assert.equal(s.record.status, 'stopped');
  assert.ok(!s.events.some((e) => e.type === 'exit' || e.type === 'error'));
  await s.agent.stop();
  assert.equal(s.killed.length, 1, 'second stop is a no-op');
});

test('start after stop resumes the same session', async () => {
  const s = await started();
  await s.agent.stop();
  const next = fakeChild(5000);
  s.agent.spawn = (exe, args, options) => {
    s.spawned.push({ exe, args, options });
    return next;
  };
  await s.agent.start();
  const args = s.spawned[1].args;
  assert.equal(args[args.indexOf('--resume') + 1], 'ef6d033a-2ef2-4ba5-b93d-edabdca54057');
  assert.equal(s.record.status, 'starting');
});

// --- Task 7: approvals ---

const { toAction } = require('../src/main/agents/claude-agent.js');
const { Approvals } = require('../src/main/approvals.js');

test('toAction maps Claude tools to policy actions', () => {
  assert.deepEqual(toAction('Bash', { command: 'npm test', description: 'x' }), { kind: 'shell', tool: 'Bash', command: 'npm test', summary: 'npm test' });
  assert.equal(toAction('PowerShell', { command: 'ls' }).kind, 'shell');
  assert.deepEqual(toAction('Read', { file_path: 'C:\wt\a.js' }), { kind: 'read', tool: 'Read', path: 'C:\wt\a.js', summary: 'C:\wt\a.js' });
  for (const tool of ['Write', 'Edit', 'MultiEdit']) assert.deepEqual(toAction(tool, { file_path: 'a.js', content: 'x' }), { kind: 'write', tool, path: 'a.js', summary: 'a.js' });
  assert.equal(toAction('NotebookEdit', { notebook_path: 'n.ipynb' }).path, 'n.ipynb');
  assert.equal(toAction('Grep', { pattern: 'TODO', path: 'src' }).path, 'src');
  assert.equal(toAction('Grep', { pattern: 'TODO' }).path, undefined);
  assert.equal(toAction('Glob', { pattern: '**/*.js' }).path, undefined);
  assert.equal(toAction('Glob', { pattern: '*.js', path: 'src' }).path, 'src');
  assert.deepEqual(toAction('WebFetch', { url: 'https://x.test' }), { kind: 'other', tool: 'WebFetch', summary: 'https://x.test' });
  assert.equal(toAction('mcp__srv__thing', {}).kind, 'other');
});

test('toAction treats a Glob pattern that leaves the worktree as its path', () => {
  for (const pattern of ['C:/Users/me/**', 'C:\Users\**\*.txt', '~/.ssh/*', '../../**', 'src/../../x/*', '\\server\share\*']) {
    assert.equal(toAction('Glob', { pattern }).path, pattern, pattern);
  }
});

test('an onApproval promise answers the CLI with its behavior and message', async () => {
  const s = setup({ agent: { onApproval: async () => ({ behavior: 'deny', message: 'Diblokir: di luar worktree agent.' }) } });
  await s.agent.start();
  await s.line(fixture('init'));
  s.agent.send('tulis');
  await s.line(fixture('control_can_use_tool'));
  await tick();
  assert.deepEqual(parse(s.child.writes[1]).response.response, { behavior: 'deny', message: 'Diblokir: di luar worktree agent.' });
});

test('a failing onApproval denies instead of leaving the CLI waiting', async () => {
  const s = setup({ agent: { onApproval: async () => { throw new Error('boom'); } } });
  await s.agent.start();
  s.agent.send('tulis');
  await s.line(fixture('control_can_use_tool'));
  await tick();
  assert.equal(parse(s.child.writes[1]).response.response.behavior, 'deny');
});

test('with approvals: Junior Write asks the owner, once allows; outside read is hard-denied with no card', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-appr-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const wt = path.join(base, '.zonder-worktrees', 'agent1');
  fs.mkdirSync(repo);
  fs.mkdirSync(wt, { recursive: true });

  const store = new AgentStore();
  const record = store.add({ id: 'agent1', name: 'Raka', role: 'Junior Developer', model: 'haiku', persona: '', workspace: repo, worktreePath: wt, status: 'stopped' });
  const events = [];
  store.subscribe((e) => events.push(e));
  const approvals = new Approvals({ store });
  const child = fakeChild();
  const agent = new ClaudeAgent({ record, store, approvals, spawn: () => child, kill: async () => child.exit(1), resolveExe: () => 'claude.exe', startQuietMs: 10 });
  t.after(() => agent.stop());
  const line = async (obj) => {
    child.stdout.write(`${JSON.stringify(obj)}\n`);
    await tick();
  };
  const canUse = (id, tool, input) => ({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: tool, tool_use_id: `tu-${id}`, input } });

  await agent.start();
  agent.send('tulis');
  await line(canUse('r1', 'Write', { file_path: path.join(wt, 'hello.txt'), content: 'hi' }));
  const card = events.find((e) => e.type === 'approval_request');
  assert.equal(card.tool, 'Write');
  assert.equal(card.summary, path.join(wt, 'hello.txt'));
  assert.equal(record.status, 'approval');
  assert.equal(child.writes.length, 1, 'nothing sent to the CLI before the owner answers');
  approvals.respond(card.requestId, 'once');
  await tick();
  assert.deepEqual(parse(child.writes[1]).response, { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', updatedInput: { file_path: path.join(wt, 'hello.txt'), content: 'hi' } } });
  assert.equal(record.status, 'working');

  await line(canUse('r2', 'Read', { file_path: path.join(repo, 'README.md') }));
  await tick();
  const res = parse(child.writes[2]).response;
  assert.equal(res.request_id, 'r2');
  assert.equal(res.response.behavior, 'deny');
  assert.match(res.response.message, /checkout utama/);
  assert.equal(events.filter((e) => e.type === 'approval_request').length, 1);
});
