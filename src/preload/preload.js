const { contextBridge, ipcRenderer } = require('electron');

// Narrow, typed API (spec §8). ipcRenderer itself is never exposed; each method
// maps to one fixed channel. A sandboxed preload cannot require local files, so
// channel names repeat CHANNELS in src/main/ipc.js.
// Still stubs until Task 9: spawnAgent, stopAgent, selectWorkspace.
const notYet = (name) => () => Promise.reject(new Error(`${name} belum tersedia`));

contextBridge.exposeInMainWorld('zonder', {
  listAgents: () => ipcRenderer.invoke('zonder:listAgents'),
  spawnAgent: notYet('spawnAgent'),
  stopAgent: notYet('stopAgent'),
  getHistory: (agentId) => ipcRenderer.invoke('zonder:getHistory', agentId),
  sendMessage: (agentId, text) => ipcRenderer.invoke('zonder:sendMessage', agentId, text),
  interruptAgent: (agentId) => ipcRenderer.invoke('zonder:interruptAgent', agentId),
  setModel: (agentId, model) => ipcRenderer.invoke('zonder:setModel', agentId, model),
  respondApproval: (requestId, decision) => ipcRenderer.invoke('zonder:respondApproval', requestId, decision),
  selectWorkspace: notYet('selectWorkspace'),
  subscribeAgentEvents: (cb) => {
    // Pass only the event payload; the IpcRendererEvent would leak sender access.
    const listener = (_e, evt) => cb(evt);
    ipcRenderer.on('zonder:event', listener);
    return () => ipcRenderer.removeListener('zonder:event', listener);
  },
});
