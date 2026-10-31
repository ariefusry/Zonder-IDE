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
