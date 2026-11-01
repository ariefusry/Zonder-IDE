const { contextBridge, ipcRenderer } = require('electron');

// Narrow, typed API (spec §8). ipcRenderer itself is never exposed; each method
// maps to one fixed channel. A sandboxed preload cannot require local files, so
// channel names repeat CHANNELS in src/main/ipc.js.

contextBridge.exposeInMainWorld('zonder', {
  listAgents: () => ipcRenderer.invoke('zonder:listAgents'),
  spawnOptions: () => ipcRenderer.invoke('zonder:spawnOptions'),
  selectWorkspace: () => ipcRenderer.invoke('zonder:selectWorkspace'),
  listBranches: (repo) => ipcRenderer.invoke('zonder:listBranches', repo),
  spawnAgent: (cfg) => ipcRenderer.invoke('zonder:spawnAgent', cfg),
  worktreeStatus: (agentId) => ipcRenderer.invoke('zonder:worktreeStatus', agentId),
  stopAgent: (agentId, cleanup, discardChanges) => ipcRenderer.invoke('zonder:stopAgent', agentId, cleanup, discardChanges),
  getHistory: (agentId) => ipcRenderer.invoke('zonder:getHistory', agentId),
  sendMessage: (agentId, text) => ipcRenderer.invoke('zonder:sendMessage', agentId, text),
  interruptAgent: (agentId) => ipcRenderer.invoke('zonder:interruptAgent', agentId),
  setModel: (agentId, model) => ipcRenderer.invoke('zonder:setModel', agentId, model),
  respondApproval: (requestId, decision) => ipcRenderer.invoke('zonder:respondApproval', requestId, decision),
  // {baseUrl, key}: the key goes in only; no method ever returns it.
  setRouterKey: (config) => ipcRenderer.invoke('zonder:setRouterKey', config),
  listModels: () => ipcRenderer.invoke('zonder:listModels'),
  resumeAgent: (agentId) => ipcRenderer.invoke('zonder:resumeAgent', agentId),
  findOrphans: () => ipcRenderer.invoke('zonder:findOrphans'),
  claudeStatus: () => ipcRenderer.invoke('zonder:claudeStatus'),
  listSkills: () => ipcRenderer.invoke('zonder:listSkills'),
  getSettings: () => ipcRenderer.invoke('zonder:getSettings'),
  updateSettings: (patch) => ipcRenderer.invoke('zonder:updateSettings', patch),
  pickDefaultRepo: () => ipcRenderer.invoke('zonder:pickDefaultRepo'),
  listRoles: () => ipcRenderer.invoke('zonder:listRoles'),
  saveRole: (role) => ipcRenderer.invoke('zonder:saveRole', role),
  deleteRole: (name) => ipcRenderer.invoke('zonder:deleteRole', name),
  resetRole: (name) => ipcRenderer.invoke('zonder:resetRole', name),
  cleanupOrphan: (wtPath, cleanup, discardChanges) => ipcRenderer.invoke('zonder:cleanupOrphan', wtPath, cleanup, discardChanges),
  subscribeAgentEvents: (cb) => {
    // Pass only the event payload; the IpcRendererEvent would leak sender access.
    const listener = (_e, evt) => cb(evt);
    ipcRenderer.on('zonder:event', listener);
    return () => ipcRenderer.removeListener('zonder:event', listener);
  },
});
