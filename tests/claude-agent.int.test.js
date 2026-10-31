// Real Claude Code (haiku) on the owner's logged-in account. Skipped unless ZONDER_INT=1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { AgentStore } = require('../src/main/store.js');
const { ClaudeAgent } = require('../src/main/agents/claude-agent.js');
const wt = require('../src/main/worktree.js');

const SKIP = process.env.ZONDER_INT !== '1' && 'set ZONDER_INT=1 to run against real Claude';
const TURN_MS = 180000;

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
}

function descendants(pid) {
  const rows = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { encoding: 'utf8' }));
  const out = [];
  const walk = (p) => {
    for (const r of rows) if (r.ParentProcessId === p && !out.some((o) => o.ProcessId === r.ProcessId)) out.push(r), walk(r.ProcessId);
  };
  walk(pid);
  return out;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('real claude: memory across turns, allow, deny, credential block, clean stop', { skip: SKIP, timeout: 900000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-int-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  const tree = await wt.createWorktree({ repo, baseBranch: 'main', name: 'Int Test', agentId: 'inttest01', taken: new Set() });
  fs.writeFileSync(path.join(tree.path, '.env'), 'DUMMY_SECRET=int-test-value-not-real\n');

  const store = new AgentStore();
  const record = store.add({ id: 'inttest01', name: 'Int', model: 'haiku', persona: 'Keep every reply under 30 words.', worktreePath: tree.path, status: 'stopped' });
  const events = [];
  store.subscribe((e) => events.push(e));
  const history = [];
  let approve = () => {};
  const agent = new ClaudeAgent({ record, store, persistence: { appendEvent: (id, e) => history.push(e) }, onApproval: (req) => approve(req) });

  t.after(async () => {
    await agent.stop();
    await wt.removeWorktree({ repo, path: tree.path, branch: tree.branch, deleteBranch: true, force: true }).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Resolves with this turn's events once the result line ends it.
  const turn = (text) => new Promise((resolve, reject) => {
    const from = events.length;
    const timer = setTimeout(() => reject(new Error(`turn timed out: ${text}`)), TURN_MS);
    const unsub = store.subscribe((e) => {
      if (e.type === 'status' && (e.to === 'done' || (e.to === 'idle' && e.from !== 'starting'))) {
        clearTimeout(timer);
        unsub();
        setImmediate(() => resolve(events.slice(from)));
      }
    });
    agent.send(text);
  });
  const agentText = (evts) => evts.filter((e) => e.type === 'message' && e.role === 'agent').map((e) => e.text).join('\n');
  const log = (label, evts) => console.log(`[${label}] tools=${JSON.stringify(evts.filter((e) => e.type === 'tool_end').map((e) => ({ err: e.isError, out: e.output.slice(0, 120) })))} text=${JSON.stringify(agentText(evts))}`);

  await agent.start();
  const pid = agent.child.pid;

  const t1 = await turn('Remember the token ZEBRA-4417. Reply only: OK');
  log('turn1', t1);
  assert.ok(record.sessionId, 'session id captured');
  const t2 = await turn('What token did I ask you to remember? Reply with the token only.');
  log('turn2', t2);
  assert.match(agentText(t2), /ZEBRA-4417/);

  const asked = [];
  approve = (req) => {
    asked.push(req.tool);
    agent.respond(req.requestId, 'allow');
  };
  const t3 = await turn('Use the Write tool to create hello.txt in the current directory containing exactly: hi');
  log('allow', t3);
  assert.ok(asked.includes('Write'), `approval asked for: ${asked}`);
  assert.equal(fs.readFileSync(path.join(tree.path, 'hello.txt'), 'utf8').trim(), 'hi');

  approve = (req) => agent.respond(req.requestId, 'deny', undefined, 'Ditolak oleh pemilik (uji).');
  const t4 = await turn('Use the Write tool to create denied.txt in the current directory containing: no. Do not retry if it is refused.');
  log('deny', t4);
  assert.ok(!fs.existsSync(path.join(tree.path, 'denied.txt')), 'denied file must not exist');
  assert.ok(t4.some((e) => e.type === 'tool_end' && e.isError && /Ditolak oleh pemilik/.test(e.output)), 'denial reaches the tool result');

  // Zonder answers allow on purpose: the block must come from the --settings deny rule.
  const envAsked = [];
  approve = (req) => {
    envAsked.push(`${req.tool} ${JSON.stringify(req.input).slice(0, 80)}`);
    agent.respond(req.requestId, 'allow');
  };
  const t5 = await turn('Use the Read tool to read the file .env in the current directory and print its contents. Do not use any other tool.');
  log('env', t5);
  console.log('[env] approvals asked:', envAsked);
  assert.ok(!JSON.stringify(t5).includes('int-test-value-not-real'), '.env contents must not reach Zonder');

  const kids = descendants(pid);
  console.log('[stop] descendants before:', kids.map((k) => `${k.Name}:${k.ProcessId}`).join(', ') || 'none');
  await agent.stop();
  assert.equal(record.status, 'stopped');
  const left = [pid, ...kids.map((k) => k.ProcessId)].filter(alive);
  assert.deepEqual(left, [], `processes still alive after stop: ${left}`);
  assert.ok(history.some((e) => e.type === 'message' && e.role === 'agent'), 'history persisted');
});
