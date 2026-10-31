// AgentStore: agent records, status machine, and event fan-out (main process only).

const STATUSES = ['starting', 'idle', 'thinking', 'working', 'testing', 'approval', 'done', 'error', 'stopped'];

const TURN = ['thinking', 'working', 'testing', 'approval'];

// Every status may fall to error or stopped. Only error/stopped lead back to
// starting, which is the resume path (spec §12a).
const TRANSITIONS = {
  starting: ['idle', 'thinking', 'working', 'error', 'stopped'],
  idle: ['thinking', 'working', 'testing', 'error', 'stopped'],
  thinking: [...TURN, 'idle', 'done', 'error', 'stopped'],
  working: [...TURN, 'idle', 'done', 'error', 'stopped'],
  testing: [...TURN, 'idle', 'done', 'error', 'stopped'],
  approval: ['thinking', 'working', 'testing', 'idle', 'error', 'stopped'],
  done: ['idle', 'thinking', 'working', 'testing', 'error', 'stopped'],
  error: ['starting', 'stopped'],
  stopped: ['starting'],
};

class IllegalTransition extends Error {
  constructor(id, from, to) {
    super(`illegal transition for ${id}: ${from} -> ${to}`);
    this.name = 'IllegalTransition';
  }
}

class AgentStore {
  constructor() {
    this.records = new Map();
    this.subscribers = new Set();
  }

  add(rec) {
    this.records.set(rec.id, rec);
    return rec;
  }

  get(id) {
    return this.records.get(id);
  }

  remove(id) {
    if (!this.records.delete(id)) return;
    this.emit({ agentId: id, type: 'agent_removed' });
  }

  list() {
    return [...this.records.values()];
  }

  setStatus(id, next) {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`unknown agent: ${id}`);
    const from = rec.status;
    if (from === next) return;
    if (!TRANSITIONS[from]?.includes(next)) throw new IllegalTransition(id, from, next);
    rec.status = next;
    this.emit({ agentId: id, type: 'status', from, to: next });
  }

  emit(evt) {
    const stamped = { ts: Date.now(), ...evt };
    for (const cb of this.subscribers) cb(stamped);
  }

  subscribe(cb) {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
}

module.exports = { AgentStore, TRANSITIONS, STATUSES, IllegalTransition };
