const path = require('node:path');

// Pure so tests can check the security settings without starting Electron.
function createWindowOptions() {
  return {
    width: 1400,
    height: 860,
    minWidth: 1100,
    minHeight: 600,
    backgroundColor: '#0b0b0c',
    title: 'Zonder',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

const MOCK = process.env.ZONDER_MOCK === '1';

function createWindow(BrowserWindow) {
  const win = new BrowserWindow(createWindowOptions());
  win.setMenuBarVisibility(false);
  // The renderer cannot read env vars, so mock mode travels as a query flag.
  const query = MOCK ? { mock: '1' } : {};
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query });
  win.once('ready-to-show', () => win.show());
  return win;
}

// Sample agents for layout work (ZONDER_MOCK=1 only). The renderer labels them as sample data.
function seedMock(store) {
  const base = { systemPrompt: '', kind: 'claude', workspace: '(contoh)', worktreePath: '(contoh)', createdAt: Date.now() };
  store.add({ ...base, id: 'a1', name: 'Raka', slug: 'raka', role: 'Senior Developer', model: 'claude-sonnet-4-6', branch: 'zonder/raka-a1', status: 'working' });
  store.add({ ...base, id: 'a2', name: 'Nadia', slug: 'nadia', role: 'Junior Developer', model: 'claude-haiku-4-5', branch: 'zonder/nadia-a2', status: 'approval' });
  store.add({ ...base, id: 'a3', name: 'Bima', slug: 'bima', role: 'Reviewer', model: 'claude-opus-4-7', branch: 'zonder/bima-a3', status: 'thinking' });
  store.add({ ...base, id: 'a4', name: 'Sari', slug: 'sari', role: 'QA Engineer', model: 'claude-haiku-4-5', branch: 'zonder/sari-a4', status: 'idle' });
  // Cycle one agent so status events visibly flow through IPC to the renderer.
  const cycle = ['thinking', 'working', 'testing', 'done', 'idle'];
  let i = 0;
  setInterval(() => store.setStatus('a4', cycle[i++ % cycle.length]), 3000).unref();
}

// Under plain node (tests) require('electron') is only the binary path.
if (process.versions.electron) {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const { AgentStore } = require('./store.js');
  const { registerIpc } = require('./ipc.js');
  const store = new AgentStore();
  let win = null;
  if (MOCK) seedMock(store);
  registerIpc({ ipcMain, store, getWindow: () => win });
  app.whenReady().then(() => {
    win = createWindow(BrowserWindow);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) win = createWindow(BrowserWindow);
    });
  });
  app.on('window-all-closed', () => app.quit());
}

module.exports = { createWindowOptions };
