// Spawn and stop over IPC, with fake git worktrees and fake agents.
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerIpc, CHANNELS } = require('../src/main/ipc.js');
const { AgentStore } = require('../src/main/store.js');
const { Approvals } = require('../src/main/approvals.js');
const { PERSONAS } = require('../src/main/personas.js');

const REPO = 'C:\\proj\\repo';

function setup({ startStatus = 'idle', createFails = false, removeFailures = 0, dirty = false, pick = REPO, roles } = {}) {
  const handlers = {};
  const store = new AgentStore();
  store.add({ id: 'a1', name: 'Contoh', sample: true, status: 'idle', workspace: '(contoh)', worktreePath: '(contoh)' });
  const events = [];
  store.subscribe((e) => events.push(e));
  const agents = new Map();
  const saves = [];
  const log = [];
  let ids = 0;
  let removeLeft = removeFailures;
  const worktree = {
    isGitRepo: async (p) => p === REPO,
    listBranches: async () => ['main', 'dev'],
    currentBranch: async () => 'dev',
    createWorktree: async (opts) => {
      log.push(['create', opts]);
      if (createFails) throw new Error('git worktree add failed: boom');
      return { path: `C:\\proj\\.zonder-worktrees\\${opts.agentId}`, branch: `zonder/x-${opts.agentId.slice(0, 6)}`, slug: opts.name.toLowerCase() };
    },
    removeWorktree: async (opts) => {
      log.push(['remove', opts]);
      if (removeLeft-- > 0) throw new Error('git worktree remove failed: Permission denied');
    },
    isDirty: async () => dirty,
  };
  const createAgent = (record) => ({
    record,
    start: async () => {
      log.push(['start', record.id]);
      store.setStatus(record.id, 'starting');
      if (startStatus === 'error') store.emit({ agentId: record.id, type: 'error', message: 'Claude Code tidak ditemukan.' });
      store.setStatus(record.id, startStatus);
    },
    stop: async () => {
      log.push(['stop', record.id]);
      if (record.status !== 'stopped') store.setStatus(record.id, 'stopped');
    },
  });
  registerIpc({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    store,
    getWindow: () => null,
    approvals: new Approvals({ store }),
    persistence: { saveAgents: (recs) => saves.push(recs.map((r) => r.id)), loadHistory: () => [] },
    agents,
    worktree,
    createAgent,
    pickFolder: async () => pick,
    newId: () => `id${String(++ids).padStart(6, '0')}`,
    retryDelayMs: 0,
    roles,
  });
  const call = (ch, ...args) => handlers[ch]({}, ...args);
  const cfg = (extra) => ({ name: 'Raka', role: 'Junior Developer', systemPrompt: 'Persona X', kind: 'claude', model: 'haiku', workspace: REPO, baseBranch: 'main', ...extra });
  return { store, events, agents, saves, log, call, cfg };
}

const picked = async (s) => s.call(CHANNELS.selectWorkspace);

test('spawnOptions lists roles with their default prompts, Claude models, and the claude and router kinds', async () => {
  const s = setup();
  const o = await s.call(CHANNELS.spawnOptions);
  assert.deepEqual(o.roles.map((r) => r.role), Object.keys(PERSONAS));
  assert.equal(o.roles[0].prompt, PERSONAS['Senior Developer']);
  assert.deepEqual(o.models, ['opus', 'sonnet', 'haiku']);
  assert.deepEqual(o.kinds, ['claude', 'router']);
});

test('selectWorkspace: cancel, non-repo, and repo with branches and current HEAD', async () => {
  assert.equal(await setup({ pick: null }).call(CHANNELS.selectWorkspace), null);
  assert.deepEqual(await setup({ pick: 'C:\\notrepo' }).call(CHANNELS.selectWorkspace), { path: 'C:\\notrepo', isRepo: false });
  assert.deepEqual(await setup().call(CHANNELS.selectWorkspace), { path: REPO, isRepo: true, branches: ['main', 'dev'], current: 'dev' });
});

test('listBranches only answers for a picked repo', async () => {
  const s = setup();
  await assert.rejects(async () => s.call(CHANNELS.listBranches, REPO), /workspace/i);
  await picked(s);
  assert.deepEqual(await s.call(CHANNELS.listBranches, REPO), ['main', 'dev']);
});

test('spawnAgent creates the worktree, record and agent, starts it and saves the registry', async () => {
  const s = setup();
  await picked(s);
  const rec = await s.call(CHANNELS.spawnAgent, s.cfg());
  assert.equal(rec.id, 'id000001');
  assert.equal(rec.persona, 'Persona X');
  assert.equal(rec.model, 'haiku');
  assert.equal(rec.role, 'Junior Developer');
  assert.equal(rec.kind, 'claude');
  assert.equal(rec.workspace, REPO);
  assert.equal(rec.baseBranch, 'main');
  assert.equal(rec.worktreePath, 'C:\\proj\\.zonder-worktrees\\id000001');
  assert.equal(rec.branch, 'zonder/x-id0000');
  assert.equal(rec.status, 'idle');
  assert.ok(s.agents.has('id000001'));
  assert.deepEqual(s.log.map((l) => l[0]), ['create', 'start']);
  assert.equal(s.log[0][1].baseBranch, 'main');
  assert.deepEqual(s.saves.at(-1), ['id000001'], 'sample records are never saved');
});

test('spawnAgent only accepts a workspace that selectWorkspace returned', async () => {
  const s = setup();
  await assert.rejects(async () => s.call(CHANNELS.spawnAgent, s.cfg()), /workspace/i);
  assert.equal(s.log.length, 0);
});

test('spawnAgent validates every field before touching git', async () => {
  const s = setup();
  await picked(s);
  await s.call(CHANNELS.spawnAgent, s.cfg());
  const bad = [
    [{ name: '' }, /nama/i],
    [{ name: '   ' }, /nama/i],
    [{ name: 'x'.repeat(41) }, /nama/i],
    [{ name: 'raka' }, /sudah dipakai/i],
    [{ role: 'Boss' }, /peran/i],
    [{ kind: 'codex' }, /jenis/i],
    [{ model: 'gpt-5' }, /model/i],
    [{ model: '' }, /model/i],
    [{ systemPrompt: 'x'.repeat(20001) }, /prompt/i],
    [{ systemPrompt: 42 }, /prompt/i],
    [{ baseBranch: 'nope' }, /branch/i],
    [{ baseBranch: '--orphan' }, /branch/i],
  ];
  for (const [extra, re] of bad) await assert.rejects(async () => s.call(CHANNELS.spawnAgent, s.cfg({ name: 'Bima', ...extra })), re, JSON.stringify(extra));
  await assert.rejects(async () => s.call(CHANNELS.spawnAgent, s.cfg(), 'extra'), /arguments/);
  await assert.rejects(async () => s.call(CHANNELS.spawnAgent, null), /cfg/i);
  assert.equal(s.log.filter((l) => l[0] === 'create').length, 1);
});

test('two spawns with the same name at once: the second is refused', async () => {
  const s = setup();
  await picked(s);
  const results = await Promise.allSettled([s.call(CHANNELS.spawnAgent, s.cfg()), s.call(CHANNELS.spawnAgent, s.cfg({ name: 'RAKA' }))]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /sudah dipakai/);
});

test('an agent that fails to start is rolled back: process stopped, worktree and branch removed, no record', async () => {
  const s = setup({ startStatus: 'error' });
  await picked(s);
  await assert.rejects(async () => s.call(CHANNELS.spawnAgent, s.cfg()), /gagal dimulai.*tidak ditemukan/i);
  assert.deepEqual(s.log.map((l) => l[0]), ['create', 'start', 'stop', 'remove']);
  const opts = s.log[3][1];
  assert.deepEqual([opts.path, opts.branch, opts.deleteBranch, opts.force], ['C:\\proj\\.zonder-worktrees\\id000001', 'zonder/x-id0000', true, true]);
  assert.equal(s.store.get('id000001'), undefined);
  assert.equal(s.agents.size, 0);
  assert.ok(s.events.some((e) => e.type === 'agent_removed' && e.agentId === 'id000001'));
  assert.ok(!s.saves.some((ids) => ids.includes('id000001')), 'never saved');
});

test('a failed worktree create leaves no record behind', async () => {
  const s = setup({ createFails: true });
  await picked(s);
  await assert.rejects(async () => s.call(CHANNELS.spawnAgent, s.cfg()), /boom/);
  assert.equal(s.store.list().length, 1);
  assert.equal(s.agents.size, 0);
});

test('worktreeStatus reports dirty, branch and path; samples have none', async () => {
  const s = setup({ dirty: true });
  await picked(s);
  const rec = await s.call(CHANNELS.spawnAgent, s.cfg());
  assert.deepEqual(await s.call(CHANNELS.worktreeStatus, rec.id), { dirty: true, branch: rec.branch, path: rec.worktreePath });
  await assert.rejects(async () => s.call(CHANNELS.worktreeStatus, 'a1'), /contoh/);
});

test('stop keep: process stopped, record stays stopped and saved, worktree untouched', async () => {
  const s = setup();
  await picked(s);
  const rec = await s.call(CHANNELS.spawnAgent, s.cfg());
  await s.call(CHANNELS.stopAgent, rec.id, 'keep', false);
  assert.equal(s.store.get(rec.id).status, 'stopped');
  assert.equal(s.agents.has(rec.id), false);
  assert.ok(!s.log.some((l) => l[0] === 'remove'));
  assert.deepEqual(s.saves.at(-1), [rec.id]);
});

for (const [cleanup, deleteBranch] of [['worktree', false], ['worktree+branch', true]]) {
  test(`stop ${cleanup}: stops first, removes the worktree, drops the record`, async () => {
    const s = setup();
    await picked(s);
    const rec = await s.call(CHANNELS.spawnAgent, s.cfg());
    await s.call(CHANNELS.stopAgent, rec.id, cleanup, false);
    assert.deepEqual(s.log.map((l) => l[0]).slice(-2), ['stop', 'remove']);
    const opts = s.log.at(-1)[1];
    assert.equal(opts.repo, REPO);
    assert.equal(opts.deleteBranch, deleteBranch);
    assert.equal(opts.force, false);
    assert.equal(s.store.get(rec.id), undefined);
    assert.deepEqual(s.saves.at(-1), []);
  });
}

test('a dirty worktree is not removed without explicit confirmation', async () => {
  const s = setup({ dirty: true });
  await picked(s);
  const rec = await s.call(CHANNELS.spawnAgent, s.cfg());
  await assert.rejects(async () => s.call(CHANNELS.stopAgent, rec.id, 'worktree', false), /belum di-commit/);
  assert.ok(!s.log.some((l) => l[0] === 'stop'), 'agent keeps running');
  await s.call(CHANNELS.stopAgent, rec.id, 'worktree', true);
  assert.equal(s.log.at(-1)[1].force, true);
  assert.equal(s.store.get(rec.id), undefined);
});

test('worktree removal is retried while Windows releases the folder', async () => {
  const s = setup({ removeFailures: 2 });
  await picked(s);
  const rec = await s.call(CHANNELS.spawnAgent, s.cfg());
  await s.call(CHANNELS.stopAgent, rec.id, 'worktree+branch', false);
  assert.equal(s.log.filter((l) => l[0] === 'remove').length, 3);
  assert.equal(s.store.get(rec.id), undefined);
});

test('if removal keeps failing the record stays, stopped, and the error is reported', async () => {
  const s = setup({ removeFailures: 99 });
  await picked(s);
  const rec = await s.call(CHANNELS.spawnAgent, s.cfg());
  await assert.rejects(async () => s.call(CHANNELS.stopAgent, rec.id, 'worktree', false), /Permission denied/);
  assert.equal(s.store.get(rec.id).status, 'stopped');
  assert.deepEqual(s.saves.at(-1), [rec.id]);
});

test('stopAgent rejects bad cleanup values, samples and unknown agents', async () => {
  const s = setup();
  await picked(s);
  const rec = await s.call(CHANNELS.spawnAgent, s.cfg());
  await assert.rejects(async () => s.call(CHANNELS.stopAgent, rec.id, 'all', false), /cleanup/);
  await assert.rejects(async () => s.call(CHANNELS.stopAgent, rec.id, 'keep', 'yes'), /discardChanges/);
  await assert.rejects(async () => s.call(CHANNELS.stopAgent, 'a1', 'keep', false), /contoh/);
  await assert.rejects(async () => s.call(CHANNELS.stopAgent, 'ghost01', 'keep', false), /tidak dikenal/);
});

test('a kept (stopped) agent can still have its worktree cleaned up later', async () => {
  const s = setup();
  await picked(s);
  const rec = await s.call(CHANNELS.spawnAgent, s.cfg());
  await s.call(CHANNELS.stopAgent, rec.id, 'keep', false);
  await s.call(CHANNELS.stopAgent, rec.id, 'worktree+branch', false);
  assert.equal(s.store.get(rec.id), undefined);
});

// Roles as data (settings plan Task 14).
const { createRoles, snapshot } = require('../src/main/roles.js');
const DESIGNER = { name: 'Designer', persona: 'Kamu Designer.', write: 'ask', shell: 'ask', skills: [], disableSkills: false };

test('spawn with role "Designer" stores record.rolePolicy = snapshot(Designer) and the persona from cfg', async () => {
  const roles = createRoles();
  roles.save(DESIGNER);
  const s = setup({ roles });
  await picked(s);
  const rec = await s.call(CHANNELS.spawnAgent, s.cfg({ role: 'Designer', systemPrompt: 'Persona khusus' }));
  assert.deepEqual(rec.rolePolicy, snapshot(roles.get('Designer')));
  assert.equal(rec.persona, 'Persona khusus');
  const o = await s.call(CHANNELS.spawnOptions);
  assert.deepEqual(o.roles.at(-1), { role: 'Designer', prompt: 'Kamu Designer.' });
});

test('editing Designer after spawn leaves the running record unchanged', async () => {
  const roles = createRoles();
  roles.save(DESIGNER);
  const s = setup({ roles });
  await picked(s);
  const rec = await s.call(CHANNELS.spawnAgent, s.cfg({ role: 'Designer' }));
  roles.save({ ...DESIGNER, write: 'allow' });
  assert.equal(s.store.get(rec.id).rolePolicy.write, 'ask');
});

test('spawn with an unknown role is refused', async () => {
  const s = setup();
  await picked(s);
  await assert.rejects(s.call(CHANNELS.spawnAgent, s.cfg({ role: 'Designer' })), /Peran tidak dikenal./);
});

test('role channels: list, save, reset, delete', async () => {
  const s = setup({ roles: createRoles() });
  assert.equal((await s.call(CHANNELS.listRoles)).length, 6);
  const saved = await s.call(CHANNELS.saveRole, DESIGNER);
  assert.equal(saved.builtin, false);
  await assert.rejects(async () => s.call(CHANNELS.saveRole, { ...DESIGNER, write: 'root' }), /Izin tulis/);
  await assert.rejects(async () => s.call(CHANNELS.saveRole, null), /invalid role/);
  const reset = await s.call(CHANNELS.resetRole, 'Reviewer');
  assert.equal(reset.write, 'deny');
  await s.call(CHANNELS.deleteRole, 'Designer');
  assert.equal((await s.call(CHANNELS.listRoles)).length, 6);
  await assert.rejects(async () => s.call(CHANNELS.deleteRole, 5), /invalid role name/);
});
