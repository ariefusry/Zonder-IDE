const { contextBridge } = require('electron');

// Narrow, typed API (spec §8). Stubs until the main-process handlers land:
// Task 2 wires listAgents/subscribeAgentEvents, Task 6 sendMessage, Task 7
// respondApproval, Task 9 spawnAgent/stopAgent/selectWorkspace.
// ipcRenderer is never exposed.
const notYet = (name) => () => Promise.reject(new Error(`${name} belum tersedia`));

contextBridge.exposeInMainWorld('zonder', {
  listAgents: () => Promise.resolve([]),
  spawnAgent: notYet('spawnAgent'),
  stopAgent: notYet('stopAgent'),
  sendMessage: notYet('sendMessage'),
  respondApproval: notYet('respondApproval'),
  selectWorkspace: notYet('selectWorkspace'),
  subscribeAgentEvents: () => () => {},
});
