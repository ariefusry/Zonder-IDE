const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentStore } = require('../src/main/store.js');
const { Approvals } = require('../src/main/approvals.js');

// Fake decide: the tool name picks the verdict; grantable asks carry a key.
function fakeDecide(role, action, ctx) {
  const key = `${action.tool}:${action.path ?? action.command ?? ''}`;
  switch (action.tool) {
    case 'Allow':
      return { verdict: 'allow', reason: 'ok', hard: false };
    case 'Deny':
      return { verdict: 'deny', reason: 'Junior tidak boleh ini.', hard: false };
    case 'Hard':
      return { verdict: 'deny', reason: 'Diblokir: di luar worktree.', hard: true };
    case 'Install':
      return { verdict: 'ask', reason: 'Memasang paket selalu bertanya.', hard: false };
    case 'Throw':
      throw new Error('boom');
    default:
      if (ctx.sessionGrants.has(key)) return { verdict: 'allow', reason: 'Diizinkan untuk sesi ini.', hard: false };
      return { verdict: 'ask', reason: 'Butuh persetujuan.', hard: false, grantKey: key };
  }
}

function setup(status = 'working') {
  const store = new AgentStore();
  store.add({ id: 'a1', name: 'Raka', role: 'Junior Developer', status });
  store.add({ id: 'a2', name: 'Nadia', role: 'Junior Developer', status: 'working' });
  const events = [];
  store.subscribe((e) => events.push(e));
  const calls = [];
  let n = 0;
  const approvals = new Approvals({
    store,
    decideFn: (role, action, ctx) => {
      calls.push({ role, action, ctx });
      return fakeDecide(role, action, ctx);
    },
    newId: () => `req-${++n}`,
  });
  const ctx = { worktree: 'C:\\wt', mainRepo: 'C:\\repo' };
  const requests = () => events.filter((e) => e.type === 'approval_request');
  return { store, events, calls, approvals, ctx, requests };
}

const write = (p = 'src/a.js') => ({ kind: 'write', tool: 'Write', path: p, summary: p });

test('allow resolves at once with no event and no status change', async () => {
  const s = setup();
  assert.deepEqual(await s.approvals.handle('a1', { kind: 'read', tool: 'Allow' }, s.ctx), { behavior: 'allow' });
  assert.equal(s.events.length, 0);
  assert.equal(s.calls[0].role, 'Junior Developer');
  assert.equal(s.calls[0].ctx.worktree, 'C:\\wt');
  assert.ok(s.calls[0].ctx.sessionGrants instanceof Set);
});

test('deny and hard deny resolve at once with the reason as the message', async () => {
  const s = setup();
  assert.deepEqual(await s.approvals.handle('a1', { kind: 'shell', tool: 'Deny' }, s.ctx), { behavior: 'deny', message: 'Junior tidak boleh ini.' });
  assert.deepEqual(await s.approvals.handle('a1', { kind: 'read', tool: 'Hard' }, s.ctx), { behavior: 'deny', message: 'Diblokir: di luar worktree.' });
  assert.equal(s.requests().length, 0);
});

test('a decide failure or unknown agent fails closed', async () => {
  const s = setup();
  const r = await s.approvals.handle('a1', { kind: 'other', tool: 'Throw' }, s.ctx);
  assert.equal(r.behavior, 'deny');
  assert.match(r.message, /izin/i);
  assert.equal((await s.approvals.handle('ghost', write(), s.ctx)).behavior, 'deny');
});

test('ask emits approval_request, sets approval, and once resolves allow then back to working', async () => {
  const s = setup();
  const p = s.approvals.handle('a1', write(), s.ctx);
  const [req] = s.requests();
  assert.deepEqual(
    { ...req, ts: undefined },
    { ts: undefined, type: 'approval_request', agentId: 'a1', requestId: 'req-1', tool: 'Write', summary: 'src/a.js', path: 'src/a.js', reason: 'Butuh persetujuan.', grantable: true },
  );
  assert.equal(s.store.get('a1').status, 'approval');
  s.approvals.respond('req-1', 'once');
  assert.deepEqual(await p, { behavior: 'allow' });
  assert.equal(s.store.get('a1').status, 'working');
  assert.deepEqual(s.events.filter((e) => e.type === 'approval_resolved').map((e) => [e.requestId, e.decision]), [['req-1', 'once']]);

  // Once is once: the same action asks again.
  s.approvals.handle('a1', write(), s.ctx);
  assert.equal(s.requests().length, 2);
});

test('session grant makes the same action auto-allow for that agent only', async () => {
  const s = setup();
  const p = s.approvals.handle('a1', write(), s.ctx);
  s.approvals.respond('req-1', 'session');
  assert.deepEqual(await p, { behavior: 'allow' });
  assert.deepEqual(await s.approvals.handle('a1', write(), s.ctx), { behavior: 'allow' });
  assert.equal(s.requests().length, 1);
  // A different path still asks; another agent has its own grants.
  s.approvals.handle('a1', write('src/b.js'), s.ctx);
  s.approvals.handle('a2', write(), s.ctx);
  assert.equal(s.requests().length, 3);
});

test('session on a non-grantable ask (install, push, delete) acts as once', async () => {
  const s = setup();
  const install = { kind: 'shell', tool: 'Install', command: 'npm i x' };
  const p = s.approvals.handle('a1', install, s.ctx);
  assert.equal(s.requests()[0].grantable, false);
  s.approvals.respond('req-1', 'session');
  assert.deepEqual(await p, { behavior: 'allow' });
  s.approvals.handle('a1', install, s.ctx);
  assert.equal(s.requests().length, 2);
});

test('deny from the owner resolves deny with a stated reason', async () => {
  const s = setup();
  const p = s.approvals.handle('a1', write(), s.ctx);
  s.approvals.respond('req-1', 'deny');
  const r = await p;
  assert.equal(r.behavior, 'deny');
  assert.match(r.message, /Ditolak oleh pemilik/);
  assert.equal(s.store.get('a1').status, 'working');
});

test('unknown, repeated or malformed responses are no-ops', async () => {
  const s = setup();
  const p = s.approvals.handle('a1', write(), s.ctx);
  s.approvals.respond('nope', 'once');
  s.approvals.respond('req-1', 'always');
  assert.equal(s.store.get('a1').status, 'approval');
  s.approvals.respond('req-1', 'deny');
  s.approvals.respond('req-1', 'once');
  assert.equal((await p).behavior, 'deny');
});

test('two pending requests keep approval until both are answered', async () => {
  const s = setup();
  const p1 = s.approvals.handle('a1', write('a'), s.ctx);
  const p2 = s.approvals.handle('a1', write('b'), s.ctx);
  s.approvals.respond('req-1', 'once');
  await p1;
  assert.equal(s.store.get('a1').status, 'approval');
  s.approvals.respond('req-2', 'once');
  await p2;
  assert.equal(s.store.get('a1').status, 'working');
});

test('stopping the agent resolves its pending requests as deny', async () => {
  const s = setup();
  const p = s.approvals.handle('a1', write(), s.ctx);
  const other = s.approvals.handle('a2', write(), s.ctx);
  s.store.setStatus('a1', 'stopped');
  const r = await p;
  assert.equal(r.behavior, 'deny');
  assert.match(r.message, /dihentikan/);
  assert.equal(s.store.get('a1').status, 'stopped');
  assert.deepEqual(s.events.filter((e) => e.type === 'approval_resolved').map((e) => [e.requestId, e.decision]), [['req-1', 'deny']]);
  // a2 is untouched.
  s.approvals.respond('req-2', 'once');
  assert.equal((await other).behavior, 'allow');
});

test('a turn that ends while a request is pending (interrupt) cancels it and stays idle', async () => {
  const s = setup();
  const p = s.approvals.handle('a1', write(), s.ctx);
  s.store.setStatus('a1', 'idle');
  assert.equal((await p).behavior, 'deny');
  s.approvals.respond('req-1', 'once');
  assert.equal(s.store.get('a1').status, 'idle');
});

test('an ask while the agent is idle still emits the request (status stays legal)', async () => {
  const s = setup('idle');
  s.approvals.handle('a1', write(), s.ctx);
  assert.equal(s.requests().length, 1);
});

test('pendingFor returns the open cards of one agent, for a renderer that reloads', async () => {
  const s = setup();
  s.approvals.handle('a1', write('a'), s.ctx);
  s.approvals.handle('a2', write('b'), s.ctx);
  const p = s.approvals.handle('a1', write('c'), s.ctx);
  s.approvals.respond('req-3', 'once');
  await p;
  const cards = s.approvals.pendingFor('a1');
  assert.deepEqual(cards.map((c) => [c.type, c.requestId, c.summary]), [['approval_request', 'req-1', 'a']]);
  assert.deepEqual(s.approvals.pendingFor('nobody'), []);
});
