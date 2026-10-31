const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentStore, TRANSITIONS, STATUSES, IllegalTransition } = require('../src/main/store.js');

function record(status = 'idle') {
  return {
    id: 'a1', name: 'Raka', slug: 'raka', role: 'Senior Developer', systemPrompt: '',
    kind: 'claude', model: 'claude-haiku-4-5', workspace: 'D:\\repo', worktreePath: 'D:\\.zonder-worktrees\\a1',
    branch: 'zonder/raka-a1', status, createdAt: 0,
  };
}

function storeWith(status) {
  const store = new AgentStore();
  store.add(record(status));
  return store;
}

test('idle -> working is allowed', () => {
  const store = storeWith('idle');
  store.setStatus('a1', 'working');
  assert.equal(store.get('a1').status, 'working');
});

test('stopped -> working throws IllegalTransition', () => {
  const store = storeWith('stopped');
  assert.throws(() => store.setStatus('a1', 'working'), IllegalTransition);
  assert.equal(store.get('a1').status, 'stopped');
});

test('approval -> working is allowed', () => {
  const store = storeWith('approval');
  store.setStatus('a1', 'working');
  assert.equal(store.get('a1').status, 'working');
});

test('error -> starting is allowed (resume)', () => {
  const store = storeWith('error');
  store.setStatus('a1', 'starting');
  assert.equal(store.get('a1').status, 'starting');
});

test('every status has a TRANSITIONS entry that only names known statuses', () => {
  for (const s of STATUSES) {
    assert.ok(Array.isArray(TRANSITIONS[s]), `missing entry for ${s}`);
    for (const next of TRANSITIONS[s]) assert.ok(STATUSES.includes(next), `${s} -> unknown ${next}`);
  }
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...STATUSES].sort());
});

test('subscribe receives a status event with from/to', () => {
  const store = storeWith('idle');
  const seen = [];
  store.subscribe((evt) => seen.push(evt));
  store.setStatus('a1', 'thinking');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'status');
  assert.equal(seen[0].agentId, 'a1');
  assert.equal(seen[0].from, 'idle');
  assert.equal(seen[0].to, 'thinking');
  assert.equal(typeof seen[0].ts, 'number');
});

test('unsubscribe stops delivery', () => {
  const store = storeWith('idle');
  const seen = [];
  const off = store.subscribe((evt) => seen.push(evt));
  off();
  store.setStatus('a1', 'working');
  store.emit({ agentId: 'a1', type: 'message', role: 'agent', text: 'hi' });
  assert.equal(seen.length, 0);
});

test('setting the current status again is a no-op without an event', () => {
  const store = storeWith('working');
  const seen = [];
  store.subscribe((evt) => seen.push(evt));
  store.setStatus('a1', 'working');
  assert.equal(seen.length, 0);
});

test('emit stamps ts and fans the event out', () => {
  const store = storeWith('idle');
  const seen = [];
  store.subscribe((evt) => seen.push(evt));
  store.emit({ agentId: 'a1', type: 'message', role: 'agent', text: 'hi' });
  assert.equal(seen[0].text, 'hi');
  assert.equal(typeof seen[0].ts, 'number');
});

test('list returns added records; unknown id throws on setStatus', () => {
  const store = storeWith('idle');
  assert.deepEqual(store.list().map((r) => r.id), ['a1']);
  assert.throws(() => store.setStatus('nope', 'working'), /unknown agent/);
});
