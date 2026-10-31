// Approval flow shared by every agent kind (spec §5): run decide(), answer
// allow/deny at once, and turn `ask` into an approval_request card that waits
// for the owner. Session grants live here, in memory only, per agent.

const { randomUUID } = require('node:crypto');
const { decide } = require('./policy/decide.js');
const { IllegalTransition } = require('./store.js');

const DECISIONS = new Set(['once', 'session', 'deny']);
// Statuses that end the turn: whatever was still waiting can no longer run.
const TURN_OVER = new Set(['idle', 'done', 'error', 'stopped']);

class Approvals {
  constructor({ store, decideFn = decide, newId = randomUUID }) {
    this.store = store;
    this.decideFn = decideFn;
    this.newId = newId;
    this.pending = new Map();
    this.grants = new Map();
    store.subscribe((evt) => {
      if (evt.type === 'agent_removed') this.grants.delete(evt.agentId);
      if (evt.type === 'status' && TURN_OVER.has(evt.to)) this.cancel(evt.agentId, evt.to === 'stopped' ? 'Agent dihentikan sebelum izin dijawab.' : 'Giliran selesai sebelum izin dijawab.');
    });
  }

  handle(agentId, action, ctx) {
    const rec = this.store.get(agentId);
    if (!rec) return Promise.resolve({ behavior: 'deny', message: `Agent tidak dikenal: ${agentId}.` });
    if (!this.grants.has(agentId)) this.grants.set(agentId, new Set());

    let d;
    try {
      d = this.decideFn(rec.role, action, { ...ctx, sessionGrants: this.grants.get(agentId) });
    } catch (err) {
      // Fail closed: the agent gets a reason instead of waiting forever.
      return Promise.resolve({ behavior: 'deny', message: `Gagal memeriksa izin: ${err.message}` });
    }
    if (d.verdict === 'allow') return Promise.resolve({ behavior: 'allow' });
    if (d.verdict !== 'ask') return Promise.resolve({ behavior: 'deny', message: d.reason });

    const requestId = this.newId();
    return new Promise((resolve) => {
      const card = {
        type: 'approval_request',
        agentId,
        requestId,
        tool: action.tool,
        summary: action.summary ?? action.command ?? action.path ?? action.tool,
        ...(action.path ? { path: action.path } : {}),
        reason: d.reason,
        grantable: Boolean(d.grantKey),
      };
      this.pending.set(requestId, { agentId, grantKey: d.grantKey, resolve, card });
      this.store.emit(card);
      this.setStatus(agentId, 'approval');
    });
  }

  respond(requestId, decision) {
    const req = this.pending.get(requestId);
    if (!req || !DECISIONS.has(decision)) return;
    // Install, push and delete asks carry no grant key, so "session" acts as once.
    if (decision === 'session' && req.grantKey) this.grants.get(req.agentId).add(req.grantKey);
    this.finish(requestId, decision, decision === 'deny' ? { behavior: 'deny', message: 'Ditolak oleh pemilik.' } : { behavior: 'allow' });
    const stillWaiting = [...this.pending.values()].some((p) => p.agentId === req.agentId);
    if (!stillWaiting && this.store.get(req.agentId)?.status === 'approval') this.setStatus(req.agentId, 'working');
  }

  // Open cards for one agent, so a reloaded renderer can show them again.
  pendingFor(agentId) {
    return [...this.pending.values()].filter((p) => p.agentId === agentId).map((p) => p.card);
  }

  cancel(agentId, message) {
    for (const [requestId, req] of this.pending) {
      if (req.agentId === agentId) this.finish(requestId, 'deny', { behavior: 'deny', message });
    }
  }

  finish(requestId, decision, result) {
    const req = this.pending.get(requestId);
    this.pending.delete(requestId);
    this.store.emit({ type: 'approval_resolved', agentId: req.agentId, requestId, decision });
    req.resolve(result);
  }

  setStatus(agentId, to) {
    try {
      this.store.setStatus(agentId, to);
    } catch (err) {
      if (!(err instanceof IllegalTransition)) throw err;
    }
  }
}

module.exports = { Approvals };
