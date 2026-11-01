const test = require('node:test');
const assert = require('node:assert/strict');
const { registerIpc, CHANNELS } = require('../src/main/ipc.js');
const { AgentStore } = require('../src/main/store.js');

function setup({ win = fakeWindow() } = {}) {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const store = new AgentStore();
  store.add({ id: 'a1', name: 'Raka', status: 'idle' });
  registerIpc({ ipcMain, store, getWindow: () => win });
  return { handlers, store, win };
}

function fakeWindow() {
  return { sent: [], destroyed: false, isDestroyed() { return this.destroyed; }, webContents: { send(ch, payload) { this.owner.sent.push([ch, payload]); } } };
}

function wire(win) {
  win.webContents.owner = win;
  return win;
}

test('listAgents returns the store records', async () => {
  const { handlers } = setup({ win: wire(fakeWindow()) });
  const agents = await handlers[CHANNELS.listAgents]({});
  assert.deepEqual(agents.map((a) => a.id), ['a1']);
});

test('listAgents rejects unexpected arguments', async () => {
  const { handlers } = setup({ win: wire(fakeWindow()) });
  await assert.rejects(async () => handlers[CHANNELS.listAgents]({}, 'extra'), /arguments/);
});

test('store events reach the renderer on the event channel', () => {
  const { store, win } = setup({ win: wire(fakeWindow()) });
  store.setStatus('a1', 'working');
  assert.equal(win.sent.length, 1);
  assert.equal(win.sent[0][0], CHANNELS.event);
  assert.equal(win.sent[0][1].to, 'working');
});

test('events are dropped when the window is gone', () => {
  const win = wire(fakeWindow());
  win.destroyed = true;
  const { store } = setup({ win });
  assert.doesNotThrow(() => store.setStatus('a1', 'working'));
  assert.equal(win.sent.length, 0);
});

test('respondApproval passes a valid decision to approvals', async () => {
  const handlers = {};
  const got = [];
  registerIpc({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, store: new AgentStore(), getWindow: () => null, approvals: { respond: (id, d) => got.push([id, d]) } });
  for (const d of ['once', 'session', 'deny']) await handlers[CHANNELS.respondApproval]({}, 'req-1', d);
  assert.deepEqual(got, [['req-1', 'once'], ['req-1', 'session'], ['req-1', 'deny']]);
});

test('respondApproval rejects bad ids, decisions and argument counts', async () => {
  const handlers = {};
  const got = [];
  registerIpc({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, store: new AgentStore(), getWindow: () => null, approvals: { respond: (id, d) => got.push([id, d]) } });
  const call = (...args) => async () => handlers[CHANNELS.respondApproval]({}, ...args);
  await assert.rejects(call('req-1', 'always'), /decision/);
  await assert.rejects(call('', 'once'), /requestId/);
  await assert.rejects(call(42, 'once'), /requestId/);
  await assert.rejects(call('x'.repeat(200), 'once'), /requestId/);
  await assert.rejects(call('req-1'), /arguments/);
  await assert.rejects(call('req-1', 'once', 'extra'), /arguments/);
  assert.equal(got.length, 0);
});

// --- Task 8: chat channels ---

function chatSetup() {
  const handlers = {};
  const store = new AgentStore();
  store.add({ id: 'agent01', name: 'Raka', status: 'idle' });
  store.add({ id: 'sample1', name: 'Contoh', status: 'idle' });
  const calls = [];
  const agent = {
    send: (t) => calls.push(['send', t]),
    interrupt: () => calls.push(['interrupt']),
    setModel: (m) => calls.push(['setModel', m]),
  };
  const persistence = { loadHistory: (id) => [{ agentId: id, ts: 1, type: 'message', role: 'user', text: 'hai' }] };
  const approvals = { respond() {}, pendingFor: (id) => [{ agentId: id, type: 'approval_request', requestId: 'r1' }] };
  registerIpc({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, store, getWindow: () => null, approvals, persistence, agents: new Map([['agent01', agent]]) });
  const call = (ch, ...args) => handlers[ch]({}, ...args);
  return { calls, call };
}

test('getHistory returns stored events plus open approval cards', async () => {
  const { call } = chatSetup();
  const res = await call(CHANNELS.getHistory, 'agent01');
  assert.equal(res.events[0].text, 'hai');
  assert.equal(res.pending[0].requestId, 'r1');
});

test('sendMessage, interruptAgent and setModel reach the running agent', async () => {
  const { calls, call } = chatSetup();
  await call(CHANNELS.sendMessage, 'agent01', 'tulis tes');
  await call(CHANNELS.interruptAgent, 'agent01');
  await call(CHANNELS.setModel, 'agent01', 'sonnet');
  assert.deepEqual(calls, [['send', 'tulis tes'], ['interrupt'], ['setModel', 'sonnet']]);
});

test('chat channels reject unknown or malformed agent ids and bad payloads', async () => {
  const { calls, call } = chatSetup();
  const rejects = (fn, re) => assert.rejects(async () => fn(), re);
  await rejects(() => call(CHANNELS.getHistory, '../x'), /agentId/);
  await rejects(() => call(CHANNELS.getHistory, 'ghost01'), /tidak dikenal/);
  await rejects(() => call(CHANNELS.sendMessage, 'sample1', 'hai'), /belum berjalan/);
  await rejects(() => call(CHANNELS.sendMessage, 'agent01', ''), /text/);
  await rejects(() => call(CHANNELS.sendMessage, 'agent01', 'x'.repeat(100001)), /text/);
  await rejects(() => call(CHANNELS.sendMessage, 'agent01', { text: 'x' }), /text/);
  await rejects(() => call(CHANNELS.setModel, 'agent01', 'gpt-5'), /model/i);
  await rejects(() => call(CHANNELS.interruptAgent, 'agent01', 'extra'), /arguments/);
  assert.equal(calls.length, 0);
});

test('setEffort validates agent id and value, and reaches the running agent', async () => {
  const handlers = {};
  const store = new AgentStore();
  store.add({ id: 'agent01', name: 'Raka', kind: 'claude', status: 'idle' });
  store.add({ id: 'rout01', name: 'Rio', kind: 'router', status: 'idle' });
  const calls = [];
  const agent = (id) => ({ setEffort: async (e) => calls.push([id, e]) });
  registerIpc({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, store, getWindow: () => null, agents: new Map([['agent01', agent('agent01')], ['rout01', agent('rout01')]]) });
  const call = (ch, ...args) => handlers[ch]({}, ...args);
  await call(CHANNELS.setEffort, 'agent01', 'max');
  await call(CHANNELS.setEffort, 'rout01', null);
  assert.deepEqual(calls, [['agent01', 'max'], ['rout01', null]]);
  await assert.rejects(async () => call(CHANNELS.setEffort, '../x', 'low'), /agentId/);
  await assert.rejects(async () => call(CHANNELS.setEffort, 'rout01', 'max'), /Effort tidak dikenal/);
  await assert.rejects(async () => call(CHANNELS.setEffort, 'agent01', 'ultra'), /Effort tidak dikenal/);
  await assert.rejects(async () => call(CHANNELS.setEffort, 'agent01'), /arguments/);
  assert.equal(calls.length, 2);
});
