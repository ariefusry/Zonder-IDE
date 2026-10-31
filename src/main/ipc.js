// IPC surface for the renderer. Every handler validates its arguments here;
// the renderer is never trusted.

const CHANNELS = {
  listAgents: 'zonder:listAgents',
  event: 'zonder:event',
  respondApproval: 'zonder:respondApproval',
};

const DECISIONS = ['once', 'session', 'deny'];

function expectArgs(args, count) {
  if (args.length !== count) throw new Error(`expected ${count} arguments, got ${args.length}`);
}

function registerIpc({ ipcMain, store, getWindow, approvals }) {
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

  store.subscribe((evt) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.event, evt);
  });
}

module.exports = { registerIpc, CHANNELS };
