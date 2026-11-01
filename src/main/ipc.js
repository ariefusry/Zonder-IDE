// IPC surface for the renderer. Every handler validates its arguments here;
// the renderer is never trusted.

const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { CLAUDE_MODELS } = require('./agents/claude-agent.js');
const { createRoles, snapshot, policyForResume } = require('./roles.js');
const { RouterOffline } = require('./agents/router-client.js');

const CHANNELS = {
  listAgents: 'zonder:listAgents',
  event: 'zonder:event',
  respondApproval: 'zonder:respondApproval',
  getHistory: 'zonder:getHistory',
  sendMessage: 'zonder:sendMessage',
  interruptAgent: 'zonder:interruptAgent',
  setModel: 'zonder:setModel',
  spawnOptions: 'zonder:spawnOptions',
  selectWorkspace: 'zonder:selectWorkspace',
  listBranches: 'zonder:listBranches',
  spawnAgent: 'zonder:spawnAgent',
  worktreeStatus: 'zonder:worktreeStatus',
  stopAgent: 'zonder:stopAgent',
  setRouterKey: 'zonder:setRouterKey',
  listModels: 'zonder:listModels',
  resumeAgent: 'zonder:resumeAgent',
  findOrphans: 'zonder:findOrphans',
  cleanupOrphan: 'zonder:cleanupOrphan',
  listRoles: 'zonder:listRoles',
  saveRole: 'zonder:saveRole',
  deleteRole: 'zonder:deleteRole',
  resetRole: 'zonder:resetRole',
};

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 100000;
const MAX_PROMPT = 20000;
const CLEANUPS = ['keep', 'worktree', 'worktree+branch'];
// Removing a worktree right after its process exits can hit a handle Windows
// has not released yet, so removal gets a few tries.
const REMOVE_TRIES = 3;

const DECISIONS = ['once', 'session', 'deny'];
const KINDS = ['claude', 'router'];
const MAX_KEY = 1000;

// Quit: stop every process, then save every real record as stopped so the next
// launch can resume it. One agent failing to stop must not block the save.
async function shutdown({ agents, store, persistence }) {
  await Promise.allSettled([...agents.values()].map((a) => a.stop()));
  agents.clear();
  store.markAllStopped();
  persistence?.saveAgents(store.list().filter((r) => !r.sample));
}

// Launch: saved records come back stopped; no process runs until the owner resumes one.
function restoreAgents({ store, persistence }) {
  let count = 0;
  for (const r of persistence.loadAgents()) {
    if (!r || typeof r !== 'object' || !AGENT_ID.test(String(r.id)) || !KINDS.includes(r.kind) || store.get(r.id)) continue;
    store.add({ ...r, sample: undefined });
    count++;
  }
  store.markAllStopped();
  return count;
}

function expectArgs(args, count) {
  if (args.length !== count) throw new Error(`expected ${count} arguments, got ${args.length}`);
}

function registerIpc({
  ipcMain,
  store,
  getWindow,
  approvals,
  persistence,
  agents = new Map(),
  worktree = require('./worktree.js'),
  createAgent,
  pickFolder,
  router,
  newId = () => randomBytes(6).toString('hex'),
  retryDelayMs = 500,
  // Built-ins only, in memory, when main.js does not pass the roles.json store.
  roles = createRoles(),
}) {
  // Only folders the owner picked in the native dialog may become a workspace:
  // the path is the policy's "main checkout", so the renderer cannot supply it.
  const pickedRepos = new Set();
  let spawnChain = Promise.resolve();
  // Model ids from the last successful /models call; spawn and setModel check against it.
  let routerModels = [];
  // Each owner runs their own router: the stored URL wins, defaultUrl only fills in until then.
  const routerUrl = () => router.secrets.getRouterUrl() || router.defaultUrl || null;

  // Router health for the sidebar and status bar. The key never leaves main:
  // not in the result, not in an error message.
  async function checkRouter() {
    const baseUrl = routerUrl();
    const hasKey = Boolean(await router.secrets.getRouterKey());
    const down = { baseUrl, hasKey, connected: false, latencyMs: null, models: [], error: null };
    if (!baseUrl || !hasKey) return down;
    const key = await router.secrets.getRouterKey();
    const now = router.now ?? Date.now;
    const t0 = now();
    try {
      routerModels = await router.listModels({ baseUrl, key });
      return { ...down, connected: true, latencyMs: now() - t0, models: routerModels };
    } catch (err) {
      return { ...down, error: err instanceof RouterOffline ? 'Router offline' : err.message };
    }
  }

  const modelsFor = (kind) => (kind === 'router' ? routerModels : CLAUDE_MODELS);

  const saveRegistry = () => persistence?.saveAgents(store.list().filter((r) => !r.sample));
  const knownAgent = (agentId) => {
    if (typeof agentId !== 'string' || !AGENT_ID.test(agentId)) throw new Error('invalid agentId');
    if (!store.get(agentId)) throw new Error(`Agent tidak dikenal: ${agentId}`);
    return agentId;
  };
  // Sample agents (mock mode) have a record but no process behind them.
  const runningAgent = (agentId) => {
    const agent = agents.get(knownAgent(agentId));
    if (!agent) throw new Error('Agent belum berjalan.');
    return agent;
  };

  const ownAgent = (agentId) => {
    const rec = store.get(knownAgent(agentId));
    if (rec.sample) throw new Error('Agent contoh tidak punya proses atau worktree.');
    return rec;
  };

  const removeWithRetry = async (opts) => {
    for (let i = 1; ; i++) {
      try {
        return await worktree.removeWorktree(opts);
      } catch (err) {
        if (i >= REMOVE_TRIES) throw err;
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  };

  async function spawn(cfg) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('invalid cfg');
    const name = typeof cfg.name === 'string' ? cfg.name.trim() : '';
    if (!name || name.length > 40) throw new Error('Nama harus 1 sampai 40 karakter.');
    if (store.list().some((r) => r.name.toLowerCase() === name.toLowerCase())) throw new Error(`Nama "${name}" sudah dipakai agent lain.`);
    const role = roles.get(cfg.role);
    if (!role) throw new Error('Peran tidak dikenal.');
    if (!KINDS.includes(cfg.kind)) throw new Error('Jenis agent ini belum tersedia.');
    if (cfg.kind === 'router') {
      const health = await checkRouter();
      if (!health.baseUrl) throw new Error('URL 9router belum diisi. Isi lewat tombol 9router di sidebar.');
      if (!health.hasKey) throw new Error('Kunci 9router belum diisi. Isi lewat tombol 9router di sidebar.');
      if (!health.connected) throw new Error(`9router tidak bisa dipakai: ${health.error}`);
    }
    if (!modelsFor(cfg.kind).includes(cfg.model)) throw new Error('Model tidak dikenal.');
    if (typeof cfg.systemPrompt !== 'string' || cfg.systemPrompt.length > MAX_PROMPT) throw new Error(`Prompt harus teks, paling banyak ${MAX_PROMPT} karakter.`);
    const repo = cfg.workspace;
    if (!pickedRepos.has(repo) || !(await worktree.isGitRepo(repo))) throw new Error('Pilih workspace lewat tombol Pilih folder.');
    if (!(await worktree.listBranches(repo)).includes(cfg.baseBranch)) throw new Error(`Branch dasar tidak ditemukan: ${cfg.baseBranch}`);

    const id = newId();
    const taken = new Set(store.list().map((r) => r.slug).filter(Boolean));
    const tree = await worktree.createWorktree({ repo, baseBranch: cfg.baseBranch, name, agentId: id, taken });
    const record = store.add({
      id, name, slug: tree.slug, role: role.name, rolePolicy: snapshot(role), kind: cfg.kind, model: cfg.model, persona: cfg.systemPrompt,
      workspace: repo, baseBranch: cfg.baseBranch, worktreePath: tree.path, branch: tree.branch,
      sessionId: null, status: 'stopped', createdAt: Date.now(),
    });
    const agent = createAgent(record);
    agents.set(id, agent);

    let lastError = null;
    const unsub = store.subscribe((e) => {
      if (e.agentId === id && e.type === 'error') lastError = e.message;
    });
    try {
      await agent.start();
    } catch (err) {
      lastError = err.message;
    } finally {
      unsub();
    }
    if (record.status !== 'error' && !lastError) {
      saveRegistry();
      return record;
    }

    // start() reports failure through status, not by throwing: undo everything.
    await agent.stop().catch(() => {});
    agents.delete(id);
    try {
      await removeWithRetry({ repo, path: tree.path, branch: tree.branch, deleteBranch: true, force: true });
    } catch (err) {
      saveRegistry();
      throw new Error(`Agent gagal dimulai: ${lastError}. Worktree juga gagal dihapus: ${err.message}`);
    }
    store.remove(id);
    throw new Error(`Agent gagal dimulai: ${lastError}`);
  }

  ipcMain.handle(CHANNELS.spawnOptions, (_e, ...args) => {
    expectArgs(args, 0);
    return { roles: roles.list().map((r) => ({ role: r.name, prompt: r.persona })), models: CLAUDE_MODELS, kinds: KINDS };
  });

  ipcMain.handle(CHANNELS.listRoles, (_e, ...args) => {
    expectArgs(args, 0);
    return roles.list();
  });

  ipcMain.handle(CHANNELS.saveRole, (_e, ...args) => {
    expectArgs(args, 1);
    return roles.save(args[0]);
  });

  const roleName = (name) => {
    if (typeof name !== 'string' || !name || name.length > 40) throw new Error('invalid role name');
    return name;
  };

  ipcMain.handle(CHANNELS.deleteRole, (_e, ...args) => {
    expectArgs(args, 1);
    roles.remove(roleName(args[0]));
  });

  ipcMain.handle(CHANNELS.resetRole, (_e, ...args) => {
    expectArgs(args, 1);
    return roles.reset(roleName(args[0]));
  });

  ipcMain.handle(CHANNELS.setRouterKey, async (_e, ...args) => {
    expectArgs(args, 1);
    const [cfg] = args;
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('invalid config');
    const { baseUrl, key } = cfg;
    if (typeof baseUrl !== 'string') throw new Error('URL router harus teks.');
    if (typeof key !== 'string' || key.length > MAX_KEY) throw new Error(`Kunci harus teks, paling banyak ${MAX_KEY} karakter.`);
    // An empty key keeps the stored one, so the URL can change without retyping it.
    if (!key.trim() && !(await router.secrets.getRouterKey())) throw new Error('Kunci 9router belum diisi.');
    // URL first: a bad URL must not leave a new key stored next to the old URL.
    router.secrets.setRouterUrl(baseUrl);
    if (key.trim()) await router.secrets.setRouterKey(key);
    return checkRouter();
  });

  ipcMain.handle(CHANNELS.listModels, (_e, ...args) => {
    expectArgs(args, 0);
    return checkRouter();
  });

  ipcMain.handle(CHANNELS.selectWorkspace, async (_e, ...args) => {
    expectArgs(args, 0);
    const picked = await pickFolder();
    if (!picked) return null;
    if (!(await worktree.isGitRepo(picked))) return { path: picked, isRepo: false };
    pickedRepos.add(picked);
    return { path: picked, isRepo: true, branches: await worktree.listBranches(picked), current: await worktree.currentBranch(picked) };
  });

  ipcMain.handle(CHANNELS.listBranches, (_e, ...args) => {
    expectArgs(args, 1);
    if (!pickedRepos.has(args[0])) throw new Error('Workspace belum dipilih.');
    return worktree.listBranches(args[0]);
  });

  // One spawn at a time, so two requests can never claim the same name.
  ipcMain.handle(CHANNELS.spawnAgent, (_e, ...args) => {
    expectArgs(args, 1);
    const run = spawnChain.then(() => spawn(args[0]));
    spawnChain = run.catch(() => {});
    return run;
  });

  ipcMain.handle(CHANNELS.worktreeStatus, async (_e, ...args) => {
    expectArgs(args, 1);
    const rec = ownAgent(args[0]);
    return { dirty: await worktree.isDirty(rec.worktreePath), branch: rec.branch, path: rec.worktreePath };
  });

  ipcMain.handle(CHANNELS.resumeAgent, async (_e, ...args) => {
    expectArgs(args, 1);
    const rec = ownAgent(args[0]);
    if (rec.status !== 'stopped' && rec.status !== 'error') throw new Error('Agent sudah berjalan.');
    if (!worktree.exists(rec.worktreePath)) throw new Error(`Worktree agent sudah tidak ada: ${rec.worktreePath}`);
    // The role as it is now applies on resume; a deleted role keeps its stored copy.
    Object.assign(rec, policyForResume(rec, roles));
    // Claude resumes its session via --resume; a router agent replays its history on start.
    let agent = agents.get(rec.id);
    if (!agent) {
      agent = createAgent(rec);
      agents.set(rec.id, agent);
    }
    await agent.start();
    saveRegistry();
    return rec;
  });

  // Worktrees under .zonder-worktrees that no record owns (a lost registry entry,
  // a crash mid-spawn). Only paths reported here may be cleaned up.
  let orphans = new Map();
  const pathKey = (p) => path.resolve(p).toLowerCase();
  ipcMain.handle(CHANNELS.findOrphans, async (_e, ...args) => {
    expectArgs(args, 0);
    const owned = new Set(store.list().filter((r) => !r.sample).map((r) => pathKey(r.worktreePath)));
    const repos = new Set([...store.list().filter((r) => !r.sample).map((r) => r.workspace), ...pickedRepos]);
    const found = new Map();
    for (const repo of repos) {
      let trees;
      try {
        trees = await worktree.listAgentWorktrees(repo);
      } catch {
        continue; // Repo moved or deleted: nothing to offer for it.
      }
      for (const t of trees) {
        if (!owned.has(pathKey(t.path))) found.set(pathKey(t.path), { repo, path: t.path, branch: t.branch });
      }
    }
    orphans = found;
    return [...found.values()];
  });

  ipcMain.handle(CHANNELS.cleanupOrphan, async (_e, ...args) => {
    expectArgs(args, 3);
    const [wtPath, cleanup, discardChanges] = args;
    if (cleanup !== 'worktree' && cleanup !== 'worktree+branch') throw new Error(`invalid cleanup: ${cleanup}`);
    if (typeof discardChanges !== 'boolean') throw new Error('invalid discardChanges');
    const o = typeof wtPath === 'string' ? orphans.get(pathKey(wtPath)) : null;
    if (!o) throw new Error('Worktree tidak dikenal. Periksa ulang worktree yatim.');
    const dirty = await worktree.isDirty(o.path);
    if (dirty && !discardChanges) throw new Error('Worktree punya perubahan yang belum di-commit. Konfirmasi untuk membuangnya.');
    const deleteBranch = cleanup === 'worktree+branch' && Boolean(o.branch);
    await removeWithRetry({ repo: o.repo, path: o.path, branch: o.branch, deleteBranch, force: dirty });
    orphans.delete(pathKey(o.path));
  });

  ipcMain.handle(CHANNELS.stopAgent, async (_e, ...args) => {
    expectArgs(args, 3);
    const [agentId, cleanup, discardChanges] = args;
    const rec = ownAgent(agentId);
    if (!CLEANUPS.includes(cleanup)) throw new Error(`invalid cleanup: ${cleanup}`);
    if (typeof discardChanges !== 'boolean') throw new Error('invalid discardChanges');
    const removing = cleanup !== 'keep';
    // Checked here, not only in the dialog: the worktree may have changed since.
    const dirty = removing && (await worktree.isDirty(rec.worktreePath));
    if (dirty && !discardChanges) throw new Error('Worktree punya perubahan yang belum di-commit. Konfirmasi untuk membuangnya.');

    const agent = agents.get(agentId);
    if (agent) {
      await agent.stop();
      agents.delete(agentId);
    }
    if (!removing) {
      saveRegistry();
      return;
    }
    try {
      await removeWithRetry({ repo: rec.workspace, path: rec.worktreePath, branch: rec.branch, deleteBranch: cleanup === 'worktree+branch', force: dirty });
    } catch (err) {
      // The folder may still exist, so the record stays and can be cleaned up later.
      saveRegistry();
      throw err;
    }
    // History stays on disk; only the registry entry goes.
    store.remove(agentId);
    saveRegistry();
  });

  ipcMain.handle(CHANNELS.listAgents, (_e, ...args) => {
    expectArgs(args, 0);
    return store.list();
  });

  ipcMain.handle(CHANNELS.respondApproval, (_e, ...args) => {
    expectArgs(args, 2);
    const [requestId, decision] = args;
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100) throw new Error('invalid requestId');
    if (!DECISIONS.includes(decision)) throw new Error(`invalid decision: ${decision}`);
    approvals.respond(requestId, decision);
  });

  ipcMain.handle(CHANNELS.getHistory, (_e, ...args) => {
    expectArgs(args, 1);
    const agentId = knownAgent(args[0]);
    return { events: persistence ? persistence.loadHistory(agentId) : [], pending: approvals?.pendingFor(agentId) ?? [] };
  });

  ipcMain.handle(CHANNELS.sendMessage, (_e, ...args) => {
    expectArgs(args, 2);
    const [agentId, text] = args;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('invalid text');
    runningAgent(agentId).send(text);
  });

  ipcMain.handle(CHANNELS.interruptAgent, (_e, ...args) => {
    expectArgs(args, 1);
    runningAgent(args[0]).interrupt();
  });

  ipcMain.handle(CHANNELS.setModel, (_e, ...args) => {
    expectArgs(args, 2);
    const [agentId, model] = args;
    const agent = runningAgent(agentId);
    if (!modelsFor(store.get(agentId).kind).includes(model)) throw new Error(`invalid model: ${model}`);
    agent.setModel(model);
  });

  store.subscribe((evt) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.event, evt);
  });
}

module.exports = { registerIpc, CHANNELS, shutdown, restoreAgents };
