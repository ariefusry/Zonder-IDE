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

// TODO(Task 9): remove. Temporary dev command for the Task 8 real run, until
// the spawn flow exists: ZONDER_DEV_REPO=<scratch git repo> starts one Junior
// Claude agent (haiku) in a fresh worktree of that repo.
async function startDevAgent({ store, persistence, approvals, agents }) {
  const { createWorktree } = require('./worktree.js');
  const { ClaudeAgent } = require('./agents/claude-agent.js');
  const repo = process.env.ZONDER_DEV_REPO;
  const id = 'devagent01';
  const tree = await createWorktree({ repo, baseBranch: 'main', name: 'Dev', agentId: id, taken: new Set() });
  const record = store.add({ id, name: 'Dev', slug: tree.slug, role: 'Junior Developer', kind: 'claude', model: 'haiku', persona: '', workspace: repo, worktreePath: tree.path, branch: tree.branch, status: 'stopped', createdAt: Date.now() });
  const agent = new ClaudeAgent({ record, store, persistence, approvals });
  agents.set(id, agent);
  await agent.start();
}

// Under plain node (tests) require('electron') is only the binary path.
if (process.versions.electron) {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const { AgentStore } = require('./store.js');
  const { registerIpc } = require('./ipc.js');
  const { Approvals } = require('./approvals.js');
  const { Persistence } = require('./persistence.js');
  const store = new AgentStore();
  const approvals = new Approvals({ store });
  // Running agent processes by id; records without one (samples) cannot chat.
  const agents = new Map();
  let persistence = null;
  let win = null;
  if (MOCK) seedMock(store);
  app.whenReady().then(() => {
    persistence = new Persistence(process.env.ZONDER_DATA_DIR || app.getPath('userData'));
    registerIpc({ ipcMain, store, getWindow: () => win, approvals, persistence, agents });
    win = createWindow(BrowserWindow);
    if (process.env.ZONDER_DEV_REPO) startDevAgent({ store, persistence, approvals, agents }).catch((err) => console.error('dev agent failed:', err));
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) win = createWindow(BrowserWindow);
    });
  });
  app.on('window-all-closed', () => app.quit());
  // Stop every agent process before quitting (full resume flow is Task 12).
  let stopping = false;
  app.on('before-quit', (e) => {
    if (stopping || !agents.size) return;
    e.preventDefault();
    stopping = true;
    Promise.allSettled([...agents.values()].map((a) => a.stop())).then(() => app.quit());
  });
}

module.exports = { createWindowOptions };
