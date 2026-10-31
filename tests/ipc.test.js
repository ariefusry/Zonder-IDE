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
