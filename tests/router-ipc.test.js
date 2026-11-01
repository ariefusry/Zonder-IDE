// setRouterKey, listModels, and router agents through spawn and setModel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerIpc, CHANNELS } = require('../src/main/ipc.js');
const { AgentStore } = require('../src/main/store.js');
const { Approvals } = require('../src/main/approvals.js');
const { RouterOffline, RouterHttpError } = require('../src/main/agents/router-client.js');

const REPO = 'C:\\proj\\repo';
const SECRET = 'sk-very-secret-123';
const URL_A = 'https://router.test/v1';

function setup({ key = null, url = null, defaultUrl = null, models = ['a/m1', 'm2'], fail = null } = {}) {
  const handlers = {};
  const store = new AgentStore();
  const agents = new Map();
  let storedKey = key;
  let storedUrl = url;
  const modelCalls = [];
  const created = [];
  const secrets = {
    setRouterKey: async (k) => { storedKey = k.trim(); },
    getRouterKey: async () => storedKey,
    setRouterUrl: (u) => {
      if (!/^https?:\/\//.test(u)) throw new Error('URL router tidak valid.');
      storedUrl = u.replace(/\/+$/, '');
    },
    getRouterUrl: () => storedUrl,
  };
  const worktree = {
    isGitRepo: async (p) => p === REPO,
    listBranches: async () => ['main'],
    currentBranch: async () => 'main',
    createWorktree: async (opts) => ({ path: `C:\\proj\\.zonder-worktrees\\${opts.agentId}`, branch: `zonder/x-${opts.agentId}`, slug: opts.name.toLowerCase() }),
    removeWorktree: async () => {},
    isDirty: async () => false,
  };
  let now = 1000;
  registerIpc({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    store,
    getWindow: () => null,
    approvals: new Approvals({ store }),
    persistence: { saveAgents: () => {}, loadHistory: () => [] },
    agents,
    worktree,
    createAgent: (record) => {
      created.push(record);
      return {
        record,
        start: async () => { store.setStatus(record.id, 'starting'); store.setStatus(record.id, 'idle'); },
        stop: async () => { store.setStatus(record.id, 'stopped'); },
        setModel: (m) => { record.model = m; },
      };
    },
    pickFolder: async () => REPO,
    router: {
      secrets,
      defaultUrl,
      listModels: async (opts) => {
        modelCalls.push(opts);
        now += 42;
        if (fail) throw fail;
        return models;
      },
      now: () => now,
    },
    newId: () => 'rid0001',
  });
  const call = async (ch, ...args) => handlers[ch]({}, ...args);
  return { store, agents, call, modelCalls, created, storedKey: () => storedKey, storedUrl: () => storedUrl };
}

const NOTHING = { baseUrl: null, hasKey: false, connected: false, latencyMs: null, models: [], error: null };

test('listModels with nothing set reports no URL and no key and does not call a router', async () => {
  const s = setup();
  assert.deepEqual(await s.call(CHANNELS.listModels), NOTHING);
  assert.equal(s.modelCalls.length, 0);
});

test('listModels with a key but no URL does not call a router either', async () => {
  const s = setup({ key: SECRET });
  assert.deepEqual(await s.call(CHANNELS.listModels), { ...NOTHING, hasKey: true });
  assert.equal(s.modelCalls.length, 0);
});

test('setRouterKey stores URL and key, checks the router, and never returns the key', async () => {
  const s = setup();
  const res = await s.call(CHANNELS.setRouterKey, { baseUrl: `${URL_A}/`, key: `  ${SECRET}  ` });
  assert.equal(s.storedKey(), SECRET);
  assert.equal(s.storedUrl(), URL_A);
  assert.deepEqual(res, { baseUrl: URL_A, hasKey: true, connected: true, latencyMs: 42, models: ['a/m1', 'm2'], error: null });
  assert.deepEqual(s.modelCalls[0], { baseUrl: URL_A, key: SECRET });
  assert.ok(!JSON.stringify(res).includes(SECRET));
});

test('setRouterKey with an empty key changes only the URL and keeps the stored key', async () => {
  const s = setup({ key: SECRET, url: URL_A });
  const res = await s.call(CHANNELS.setRouterKey, { baseUrl: 'https://other.test/v1', key: '' });
  assert.equal(s.storedKey(), SECRET);
  assert.equal(res.baseUrl, 'https://other.test/v1');
  assert.equal(s.modelCalls[0].baseUrl, 'https://other.test/v1');
});

test('setRouterKey: a bad URL stores nothing, not even the key', async () => {
  const s = setup();
  await assert.rejects(s.call(CHANNELS.setRouterKey, { baseUrl: 'router.test', key: SECRET }), /URL/);
  assert.equal(s.storedKey(), null);
  assert.equal(s.storedUrl(), null);
});

test('setRouterKey rejects bad shapes, oversized keys, and a first save without a key', async () => {
  const s = setup();
  for (const bad of [undefined, 'just-a-key', { baseUrl: URL_A, key: 7 }, { baseUrl: URL_A, key: 'x'.repeat(1001) }, { baseUrl: 7, key: 'k' }, [URL_A]]) {
    await assert.rejects(s.call(CHANNELS.setRouterKey, bad), /Kunci|URL|config/, JSON.stringify(bad));
  }
  await assert.rejects(s.call(CHANNELS.setRouterKey, { baseUrl: URL_A, key: '' }), /Kunci/);
  await assert.rejects(s.call(CHANNELS.setRouterKey, { baseUrl: URL_A, key: 'a' }, 'b'), /expected 1 arguments/);
});

test('the default URL (ZONDER_ROUTER_URL) applies until the owner stores one', async () => {
  const s = setup({ key: SECRET, defaultUrl: 'http://127.0.0.1:9/v1' });
  assert.equal((await s.call(CHANNELS.listModels)).baseUrl, 'http://127.0.0.1:9/v1');
  await s.call(CHANNELS.setRouterKey, { baseUrl: URL_A, key: '' });
  assert.equal((await s.call(CHANNELS.listModels)).baseUrl, URL_A);
});

test('listModels: router offline and HTTP errors come back as disconnected, without the key', async () => {
  const off = setup({ key: SECRET, url: URL_A, fail: new RouterOffline(new TypeError('fetch failed')) });
  assert.deepEqual(await off.call(CHANNELS.listModels), { baseUrl: URL_A, hasKey: true, connected: false, latencyMs: null, models: [], error: 'Router offline' });
  const http = setup({ key: SECRET, url: URL_A, fail: new RouterHttpError(401, 'unauthorized') });
  const res = await http.call(CHANNELS.listModels);
  assert.equal(res.connected, false);
  assert.match(res.error, /401/);
  assert.ok(!JSON.stringify(res).includes(SECRET));
});

test('spawn a router agent: the model must be one the router listed', async () => {
  const s = setup({ key: SECRET, url: URL_A });
  await s.call(CHANNELS.selectWorkspace);
  const cfg = (model) => ({ name: 'Rio', role: 'Junior Developer', systemPrompt: '', kind: 'router', model, workspace: REPO, baseBranch: 'main' });
  await assert.rejects(s.call(CHANNELS.spawnAgent, cfg('opus')), /Model tidak dikenal/);
  const rec = await s.call(CHANNELS.spawnAgent, cfg('a/m1'));
  assert.equal(rec.kind, 'router');
  assert.equal(rec.model, 'a/m1');
  assert.equal(rec.status, 'idle');
  assert.equal(s.created[0].kind, 'router');
});

test('spawn a router agent without URL or key is refused before git is touched', async () => {
  const cfg = { name: 'Rio', role: 'Junior Developer', systemPrompt: '', kind: 'router', model: 'm2', workspace: REPO, baseBranch: 'main' };
  const noKey = setup({ url: URL_A });
  await noKey.call(CHANNELS.selectWorkspace);
  await assert.rejects(noKey.call(CHANNELS.spawnAgent, cfg), /Kunci 9router/);
  const noUrl = setup({ key: SECRET });
  await noUrl.call(CHANNELS.selectWorkspace);
  await assert.rejects(noUrl.call(CHANNELS.spawnAgent, cfg), /URL 9router/);
  assert.equal(noKey.created.length + noUrl.created.length, 0);
});

test('setModel checks the model list of the agent\'s own kind', async () => {
  const s = setup({ key: SECRET, url: URL_A });
  await s.call(CHANNELS.selectWorkspace);
  const rec = await s.call(CHANNELS.spawnAgent, { name: 'Rio', role: 'Junior Developer', systemPrompt: '', kind: 'router', model: 'm2', workspace: REPO, baseBranch: 'main' });
  await assert.rejects(s.call(CHANNELS.setModel, rec.id, 'haiku'), /invalid model/);
  await s.call(CHANNELS.setModel, rec.id, 'a/m1');
  assert.equal(rec.model, 'a/m1');
});
