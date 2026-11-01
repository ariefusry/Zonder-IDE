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
// Each owner runs their own 9router, so there is no built-in URL: it is set in the
// 9router dialog. ZONDER_ROUTER_URL fills in until then (automated checks use it).
const ROUTER_URL = process.env.ZONDER_ROUTER_URL || null;

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
  // sample: true keeps them out of agents.json and away from spawn/stop.
  const base = { sample: true, persona: '', kind: 'claude', workspace: '(contoh)', worktreePath: '(contoh)', createdAt: Date.now() };
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
  const { app, BrowserWindow, ipcMain, dialog, safeStorage, Notification } = require('electron');
  const { AgentStore } = require('./store.js');
  const { registerIpc, shutdown, restoreAgents } = require('./ipc.js');
  const { Approvals } = require('./approvals.js');
  const { Persistence } = require('./persistence.js');
  const { ClaudeAgent } = require('./agents/claude-agent.js');
  const { RouterAgent } = require('./agents/router-agent.js');
  const { listModels } = require('./agents/router-client.js');
  const { createSecrets } = require('./secrets.js');
  const { createRoles } = require('./roles.js');
  const { createSettings } = require('./settings.js');
  const { startNotifier } = require('./notify.js');
  const store = new AgentStore();
  const approvals = new Approvals({ store });
  // Running agent processes by id; records without one (samples) cannot chat.
  const agents = new Map();
  let persistence = null;
  let win = null;
  // Automated smoke runs cannot click the native folder dialog, so
  // ZONDER_TEST_WORKSPACE stands in for the owner's pick. It goes through the
  // same repo check and allowlist as a real pick.
  const pickFolder = async () => {
    if (process.env.ZONDER_TEST_WORKSPACE) return process.env.ZONDER_TEST_WORKSPACE;
    const res = await dialog.showOpenDialog(win, { title: 'Pilih workspace (folder repo Git)', properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  };
  if (MOCK) seedMock(store);
  // Windows shows toasts only for an app with an AppUserModelID; without an
  // installer (out of scope) the Electron binary path is the one that works.
  if (process.platform === 'win32') app.setAppUserModelId(process.execPath);
  app.whenReady().then(() => {
    const dataDir = process.env.ZONDER_DATA_DIR || app.getPath('userData');
    persistence = new Persistence(dataDir);
    const secrets = createSecrets({ dir: dataDir, safeStorage });
    const roles = createRoles({ dir: dataDir });
    const settings = createSettings({ dir: dataDir });
    startNotifier({ store, getWindow: () => win, settings, Notification });
    // Saved agents come back stopped; the owner resumes each one from its chat.
    if (!MOCK) restoreAgents({ store, persistence });
    registerIpc({
      ipcMain,
      store,
      getWindow: () => win,
      approvals,
      persistence,
      agents,
      createAgent: (record) => (record.kind === 'router'
        ? new RouterAgent({ record, store, persistence, approvals, getKey: secrets.getRouterKey, baseUrl: () => secrets.getRouterUrl() || ROUTER_URL, limits: () => settings.get().agent })
        : new ClaudeAgent({ record, store, persistence, approvals })),
      pickFolder,
      router: { defaultUrl: ROUTER_URL, secrets, listModels },
      roles,
      settings,
    });
    win = createWindow(BrowserWindow);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) win = createWindow(BrowserWindow);
    });
  });
  app.on('window-all-closed', () => app.quit());
  // Stop every agent process before quitting, then save the records as stopped
  // (with their session ids) so the next launch can resume them.
  let stopping = false;
  app.on('before-quit', (e) => {
    if (stopping || !agents.size) return;
    e.preventDefault();
    stopping = true;
    shutdown({ agents, store, persistence }).finally(() => app.quit());
  });
}

module.exports = { createWindowOptions };
