// IPC surface for the renderer. Every handler validates its arguments here;
// the renderer is never trusted.

const { CLAUDE_MODELS } = require('./agents/claude-agent.js');

const CHANNELS = {
  listAgents: 'zonder:listAgents',
  event: 'zonder:event',
  respondApproval: 'zonder:respondApproval',
  getHistory: 'zonder:getHistory',
  sendMessage: 'zonder:sendMessage',
  interruptAgent: 'zonder:interruptAgent',
  setModel: 'zonder:setModel',
};

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 100000;

const DECISIONS = ['once', 'session', 'deny'];

function expectArgs(args, count) {
  if (args.length !== count) throw new Error(`expected ${count} arguments, got ${args.length}`);
}

function registerIpc({ ipcMain, store, getWindow, approvals, persistence, agents = new Map() }) {
  const knownAgent = (agentId) => {
    if (typeof agentId !== 'string' || !AGENT_ID.test(agentId)) throw new Error('invalid agentId');
    if (!store.get(agentId)) throw new Error(`Agent tidak dikenal: ${agentId}`);
    return agentId;
  };
  // Sample agents (mock mode) have a record but no process behind them.
  const runningAgent = (agentId) => {
    const agent = agents.get(knownAgent(agentId));
    if (!agent) throw new Error('Agent belum berjalan.');
    return agent;
  };

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

  ipcMain.handle(CHANNELS.getHistory, (_e, ...args) => {
    expectArgs(args, 1);
    const agentId = knownAgent(args[0]);
    return { events: persistence ? persistence.loadHistory(agentId) : [], pending: approvals?.pendingFor(agentId) ?? [] };
  });

  ipcMain.handle(CHANNELS.sendMessage, (_e, ...args) => {
    expectArgs(args, 2);
    const [agentId, text] = args;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('invalid text');
    runningAgent(agentId).send(text);
  });

  ipcMain.handle(CHANNELS.interruptAgent, (_e, ...args) => {
    expectArgs(args, 1);
    runningAgent(args[0]).interrupt();
  });

  ipcMain.handle(CHANNELS.setModel, (_e, ...args) => {
    expectArgs(args, 2);
    const [agentId, model] = args;
    if (!CLAUDE_MODELS.includes(model)) throw new Error(`invalid model: ${model}`);
    runningAgent(agentId).setModel(model);
  });

  store.subscribe((evt) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.event, evt);
  });
}

module.exports = { registerIpc, CHANNELS };
