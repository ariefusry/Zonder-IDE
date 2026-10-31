const { contextBridge, ipcRenderer } = require('electron');

// Narrow, typed API (spec §8). ipcRenderer itself is never exposed; each method
// maps to one fixed channel. A sandboxed preload cannot require local files, so
// channel names repeat CHANNELS in src/main/ipc.js.
// Still stubs until Task 9 wires real agents: sendMessage, spawnAgent,
// stopAgent, selectWorkspace.
const notYet = (name) => () => Promise.reject(new Error(`${name} belum tersedia`));

contextBridge.exposeInMainWorld('zonder', {
  listAgents: () => ipcRenderer.invoke('zonder:listAgents'),
  spawnAgent: notYet('spawnAgent'),
  stopAgent: notYet('stopAgent'),
  sendMessage: notYet('sendMessage'),
  respondApproval: (requestId, decision) => ipcRenderer.invoke('zonder:respondApproval', requestId, decision),
  selectWorkspace: notYet('selectWorkspace'),
  subscribeAgentEvents: (cb) => {
    // Pass only the event payload; the IpcRendererEvent would leak sender access.
    const listener = (_e, evt) => cb(evt);
    ipcRenderer.on('zonder:event', listener);
    return () => ipcRenderer.removeListener('zonder:event', listener);
  },
});
