// Quit, relaunch, resume (Task 12): stop everything on quit, restore records as
// stopped, resume Claude via --resume and 9router by replaying history, and
// report worktrees that no record owns.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerIpc, CHANNELS, shutdown, restoreAgents } = require('../src/main/ipc.js');
const { AgentStore } = require('../src/main/store.js');
const { Approvals } = require('../src/main/approvals.js');
const { Persistence } = require('../src/main/persistence.js');
const { replayHistory } = require('../src/main/agents/router-agent.js');

const REPO = 'C:\\proj\\repo';
const WT = (id) => `C:\\proj\\.zonder-worktrees\\${id}`;

const rec = (id, extra) => ({
  id, name: `N${id}`, slug: `n${id}`, role: 'Junior Developer', kind: 'claude', model: 'haiku', persona: '',
  workspace: REPO, baseBranch: 'main', worktreePath: WT(id), branch: `zonder/n${id}-${id}`,
  sessionId: null, status: 'idle', createdAt: 1, ...extra,
});

function fakeAgent(store, record, log) {
  return {
    record,
    start: async () => {
      log.push(['start', record.id]);
      store.setStatus(record.id, 'starting');
      store.setStatus(record.id, 'idle');
    },
    stop: async () => {
      log.push(['stop', record.id]);
      if (record.status !== 'stopped') store.setStatus(record.id, 'stopped');
    },
  };
}

function setup({ records = [], gitWorktrees = [], existing = null, dirty = false } = {}) {
  const handlers = {};
  const store = new AgentStore();
  for (const r of records) store.add(r);
  const agents = new Map();
  const log = [];
  const saves = [];
  const worktree = {
    isGitRepo: async (p) => p === REPO,
    listBranches: async () => ['main'],
    currentBranch: async () => 'main',
    createWorktree: async () => { throw new Error('not used'); },
    removeWorktree: async (opts) => log.push(['remove', opts]),
    isDirty: async () => dirty,
    exists: (p) => (existing ? existing.includes(p) : true),
    listAgentWorktrees: async (repo) => (repo === REPO ? gitWorktrees : []),
  };
  registerIpc({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    store,
    getWindow: () => null,
    approvals: new Approvals({ store }),
    persistence: { saveAgents: (recs) => saves.push(recs.map((r) => `${r.id}:${r.status}`)), loadHistory: () => [] },
    agents,
    worktree,
    createAgent: (record) => fakeAgent(store, record, log),
    pickFolder: async () => REPO,
    retryDelayMs: 0,
  });
  const call = (ch, ...args) => handlers[ch]({}, ...args);
  return { store, agents, log, saves, call };
}

test('markAllStopped sets every non-sample record to stopped and leaves samples alone', () => {
  const store = new AgentStore();
  store.add(rec('a1', { status: 'thinking' }));
  store.add(rec('a2', { status: 'error' }));
  store.add(rec('a3', { status: 'stopped' }));
  store.add({ id: 's1', name: 'Contoh', sample: true, status: 'working' });
  store.markAllStopped();
  assert.deepEqual(store.list().map((r) => r.status), ['stopped', 'stopped', 'stopped', 'working']);
});

test('shutdown stops every agent, then saves every real record as stopped', async () => {
  const store = new AgentStore();
  const log = [];
  const agents = new Map();
  for (const id of ['a1', 'a2']) {
    const r = store.add(rec(id, { status: id === 'a1' ? 'working' : 'idle' }));
    agents.set(id, fakeAgent(store, r, log));
  }
  store.add(rec('a3', { status: 'stopped' }));
  store.add({ id: 's1', name: 'Contoh', sample: true, status: 'idle' });
  let saved = null;
  await shutdown({ agents, store, persistence: { saveAgents: (r) => { saved = r; } } });
  assert.deepEqual(log, [['stop', 'a1'], ['stop', 'a2']]);
  assert.deepEqual(saved.map((r) => `${r.id}:${r.status}`), ['a1:stopped', 'a2:stopped', 'a3:stopped']);
});

test('shutdown still saves when one agent fails to stop', async () => {
  const store = new AgentStore();
  const r = store.add(rec('a1', { status: 'working' }));
  const agents = new Map([['a1', { record: r, stop: async () => { throw new Error('kill failed'); } }]]);
  let saved = null;
  await shutdown({ agents, store, persistence: { saveAgents: (x) => { saved = x; } } });
  assert.deepEqual(saved.map((x) => x.status), ['stopped']);
});

test('restoreAgents brings saved records back as stopped, and their history stays on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-life-'));
  const p = new Persistence(dir);
  p.saveAgents([rec('a1', { status: 'thinking', sessionId: 'sess-1' }), rec('a2', { status: 'stopped' })]);
  p.appendEvent('a1', { type: 'message', role: 'user', text: 'halo' });
  const store = new AgentStore();
  assert.equal(restoreAgents({ store, persistence: p }), 2);
  assert.deepEqual(store.list().map((r) => [r.id, r.status, r.sessionId]), [['a1', 'stopped', 'sess-1'], ['a2', 'stopped', null]]);
  assert.deepEqual(new Persistence(dir).loadHistory('a1').map((e) => e.text), ['halo']);
});

test('restoreAgents skips entries without a valid id or kind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-life-'));
  const p = new Persistence(dir);
  p.saveAgents([rec('a1'), { id: '../x', kind: 'claude' }, { id: 'b1', kind: 'codex' }, null]);
  const store = new AgentStore();
  assert.equal(restoreAgents({ store, persistence: p }), 1);
  assert.deepEqual(store.list().map((r) => r.id), ['a1']);
});

test('resumeAgent starts a stopped agent with a fresh process object and saves the registry', async () => {
  const s = setup({ records: [rec('a1', { status: 'stopped', sessionId: 'sess-1' })] });
  const out = await s.call(CHANNELS.resumeAgent, 'a1');
  assert.equal(out.status, 'idle');
  assert.equal(s.agents.get('a1').record.sessionId, 'sess-1');
  assert.deepEqual(s.log, [['start', 'a1']]);
  assert.deepEqual(s.saves.at(-1), ['a1:idle']);
});

test('resumeAgent reuses the agent object of an agent in error', async () => {
  const s = setup({ records: [rec('a1', { status: 'error' })] });
  const existing = fakeAgent(s.store, s.store.get('a1'), s.log);
  s.agents.set('a1', existing);
  await s.call(CHANNELS.resumeAgent, 'a1');
  assert.equal(s.agents.get('a1'), existing);
});

test('resumeAgent refuses a running agent, a sample, and a missing worktree', async () => {
  const s = setup({ records: [rec('a1', { status: 'idle' }), rec('a2', { status: 'stopped' }), { id: 's1', name: 'C', sample: true, status: 'stopped' }], existing: [WT('a1')] });
  await assert.rejects(s.call(CHANNELS.resumeAgent, 'a1'), /sudah berjalan/);
  await assert.rejects(s.call(CHANNELS.resumeAgent, 's1'), /Agent contoh/);
  await assert.rejects(s.call(CHANNELS.resumeAgent, 'a2'), /Worktree agent sudah tidak ada/);
  assert.deepEqual(s.log, []);
});

test('findOrphans reports Zonder worktrees that no record owns, matching paths case-insensitively', async () => {
  const s = setup({
    records: [rec('a1', { status: 'stopped' })],
    gitWorktrees: [{ path: WT('a1').toLowerCase(), branch: 'zonder/na1-a1' }, { path: WT('zz9'), branch: 'zonder/old-zz9' }],
  });
  assert.deepEqual(await s.call(CHANNELS.findOrphans), [{ repo: REPO, path: WT('zz9'), branch: 'zonder/old-zz9' }]);
});

test('cleanupOrphan removes only a path findOrphans reported, with the chosen branch handling', async () => {
  const s = setup({ records: [rec('a1', { status: 'stopped' })], gitWorktrees: [{ path: WT('zz9'), branch: 'zonder/old-zz9' }] });
  await assert.rejects(s.call(CHANNELS.cleanupOrphan, WT('zz9'), 'worktree', false), /Worktree tidak dikenal/);
  await s.call(CHANNELS.findOrphans);
  await assert.rejects(s.call(CHANNELS.cleanupOrphan, WT('other'), 'worktree', false), /Worktree tidak dikenal/);
  await assert.rejects(s.call(CHANNELS.cleanupOrphan, WT('zz9'), 'keep', false), /invalid cleanup/);
  await s.call(CHANNELS.cleanupOrphan, WT('zz9'), 'worktree+branch', false);
  assert.deepEqual(s.log, [['remove', { repo: REPO, path: WT('zz9'), branch: 'zonder/old-zz9', deleteBranch: true, force: false }]]);
  await assert.rejects(s.call(CHANNELS.cleanupOrphan, WT('zz9'), 'worktree', false), /Worktree tidak dikenal/);
});

test('cleanupOrphan on a dirty worktree needs discardChanges', async () => {
  const s = setup({ gitWorktrees: [{ path: WT('zz9'), branch: 'zonder/old-zz9' }], dirty: true, records: [rec('a1', { status: 'stopped' })] });
  await s.call(CHANNELS.findOrphans);
  await assert.rejects(s.call(CHANNELS.cleanupOrphan, WT('zz9'), 'worktree', false), /belum di-commit/);
  await s.call(CHANNELS.cleanupOrphan, WT('zz9'), 'worktree', true);
  assert.equal(s.log.at(-1)[1].force, true);
});

test('replayHistory rebuilds the router conversation from user and agent messages only', () => {
  const events = [
    { type: 'message', role: 'user', text: 'baca a.txt' },
    { type: 'tool_start', tool: 'read_file' },
    { type: 'tool_end', tool: 'read_file', output: 'x' },
    { type: 'message', role: 'agent', text: 'Isinya x.' },
    { type: 'error', message: 'Router offline' },
    { type: 'message', role: 'user', text: '' },
    { type: 'exit' },
  ];
  assert.deepEqual(replayHistory(events), [
    { role: 'user', content: 'baca a.txt' },
    { role: 'assistant', content: 'Isinya x.' },
  ]);
});
