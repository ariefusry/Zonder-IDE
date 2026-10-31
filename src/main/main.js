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

function createWindow(BrowserWindow) {
  const win = new BrowserWindow(createWindowOptions());
  win.setMenuBarVisibility(false);
  // The renderer cannot read env vars, so mock mode travels as a query flag.
  const query = process.env.ZONDER_MOCK === '1' ? { mock: '1' } : {};
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query });
  win.once('ready-to-show', () => win.show());
  return win;
}

// Under plain node (tests) require('electron') is only the binary path.
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  app.whenReady().then(() => {
    createWindow(BrowserWindow);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(BrowserWindow);
    });
  });
  app.on('window-all-closed', () => app.quit());
}

module.exports = { createWindowOptions };
