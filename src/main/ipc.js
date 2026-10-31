// IPC surface for the renderer. Every handler validates its arguments here;
// the renderer is never trusted.

const CHANNELS = {
  listAgents: 'zonder:listAgents',
  event: 'zonder:event',
};

function expectArgs(args, count) {
  if (args.length !== count) throw new Error(`expected ${count} arguments, got ${args.length}`);
}

function registerIpc({ ipcMain, store, getWindow }) {
  ipcMain.handle(CHANNELS.listAgents, (_e, ...args) => {
    expectArgs(args, 0);
    return store.list();
  });

  store.subscribe((evt) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.event, evt);
  });
}

module.exports = { registerIpc, CHANNELS };
