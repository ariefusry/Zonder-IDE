const test = require('node:test');
const assert = require('node:assert/strict');
const { eventToViewModel, reduceChat, splitFences } = require('../src/renderer/render-message.js');

const ev = (type, extra) => ({ agentId: 'a1', ts: 1, type, ...extra });
const run = (events) => events.reduce(reduceChat, []);

test('user and agent messages', () => {
  assert.deepEqual(eventToViewModel(ev('message', { role: 'user', text: 'hai', queued: true })), { kind: 'user', text: 'hai', ts: 1 });
  assert.deepEqual(eventToViewModel(ev('message', { role: 'agent', text: 'siap' })), { kind: 'agent', text: 'siap', blocks: [{ type: 'text', text: 'siap' }], streaming: false });
});

test('fenced code blocks split into text and code parts; markup stays plain text', () => {
  assert.deepEqual(splitFences('Ini:\n```js\nconst a = 1;\n```\nselesai <b>x</b>'), [
    { type: 'text', text: 'Ini:' },
    { type: 'code', lang: 'js', text: 'const a = 1;' },
    { type: 'text', text: 'selesai <b>x</b>' },
  ]);
  assert.deepEqual(splitFences('```\nno lang\n```'), [{ type: 'code', lang: '', text: 'no lang' }]);
  // An unclosed fence (mid-stream) still shows as code.
  assert.deepEqual(splitFences('a\n```py\nprint(1)'), [{ type: 'text', text: 'a' }, { type: 'code', lang: 'py', text: 'print(1)' }]);
  assert.deepEqual(splitFences(''), []);
});

test('tool_start and tool_end merge into one collapsed row', () => {
  const items = run([
    ev('tool_start', { toolUseId: 't1', tool: 'Bash', summary: 'npm test', input: { command: 'npm test' } }),
    ev('tool_end', { toolUseId: 't1', isError: false, output: 'ok 3' }),
  ]);
  assert.deepEqual(items, [{ kind: 'tool', toolUseId: 't1', tag: 'bash', summary: 'npm test', state: 'done', output: 'ok 3' }]);
  const failed = run([ev('tool_start', { toolUseId: 't2', tool: 'Write', summary: 'a.js' }), ev('tool_end', { toolUseId: 't2', isError: true, output: 'Ditolak' })]);
  assert.equal(failed[0].state, 'error');
  assert.equal(run([ev('tool_start', { toolUseId: 't3', tool: 'Read', summary: 'b' })])[0].state, 'running');
});

test('a tool_end with no matching row is shown on its own, not lost', () => {
  const items = run([ev('tool_end', { toolUseId: 'zz', isError: true, output: 'x' })]);
  assert.equal(items[0].kind, 'tool');
  assert.equal(items[0].state, 'error');
});

test('approval card offers three choices, or two when session would act as once', () => {
  const card = eventToViewModel(ev('approval_request', { requestId: 'r1', tool: 'Write', summary: 'a.js', path: 'a.js', reason: 'Butuh persetujuan.', grantable: true }));
  assert.equal(card.kind, 'approval');
  assert.deepEqual(card.choices.map((c) => [c.decision, c.label]), [['once', 'Izinkan sekali'], ['session', 'Izinkan untuk sesi ini'], ['deny', 'Tolak']]);
  assert.equal(card.resolved, null);
  const install = eventToViewModel(ev('approval_request', { requestId: 'r2', tool: 'Bash', summary: 'npm i zod', reason: 'Memasang paket selalu bertanya.', grantable: false }));
  assert.deepEqual(install.choices.map((c) => c.decision), ['once', 'deny']);
});

test('approval_resolved marks the card with the decision', () => {
  const items = run([
    ev('approval_request', { requestId: 'r1', tool: 'Write', summary: 'a.js', reason: 'x', grantable: true }),
    ev('approval_resolved', { requestId: 'r1', decision: 'session' }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].resolved, 'session');
});

test('errors become error rows; status, exit, queue, model and session events add nothing', () => {
  assert.deepEqual(eventToViewModel(ev('error', { message: 'Claude berhenti' })), { kind: 'error', text: 'Claude berhenti' });
  for (const e of [ev('status', { from: 'idle', to: 'thinking' }), ev('exit', { code: 1 }), ev('queue', { count: 2 }), ev('model', { model: 'opus' }), ev('session', {})]) {
    assert.equal(eventToViewModel(e), null, e.type);
    assert.deepEqual(run([e]), [], e.type);
  }
});

test('deltas grow one streaming bubble that the final message replaces', () => {
  const items = run([
    ev('message', { role: 'user', text: 'hitung' }),
    ev('delta', { text: 'one' }),
    ev('delta', { text: ', two' }),
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[1], { kind: 'agent', text: 'one, two', blocks: [{ type: 'text', text: 'one, two' }], streaming: true });
  const done = reduceChat(items, ev('message', { role: 'agent', text: 'one, two, three' }));
  assert.equal(done.length, 2);
  assert.deepEqual(done[1], { kind: 'agent', text: 'one, two, three', blocks: [{ type: 'text', text: 'one, two, three' }], streaming: false });
});

test('a message with no stream before it is appended, and the next deltas start a new bubble', () => {
  const items = run([ev('message', { role: 'agent', text: 'a' }), ev('delta', { text: 'b' })]);
  assert.deepEqual(items.map((i) => [i.text, i.streaming]), [['a', false], ['b', true]]);
});

test('an interrupted stream is closed when the turn ends, keeping its partial text', () => {
  let items = run([ev('delta', { text: 'setengah' })]);
  items = reduceChat(items, ev('status', { from: 'thinking', to: 'idle' }));
  assert.equal(items[0].streaming, false);
  assert.equal(items[0].text, 'setengah');
  items = reduceChat(items, ev('delta', { text: 'baru' }));
  assert.equal(items.length, 2);
  for (const to of ['done', 'error', 'stopped']) assert.equal(run([ev('delta', { text: 'x' }), ev('status', { to })])[0].streaming, false, to);
  assert.equal(run([ev('delta', { text: 'x' }), ev('status', { to: 'working' })])[0].streaming, true);
});

test('a tool call between deltas closes the bubble so later text starts fresh', () => {
  const items = run([ev('delta', { text: 'Menulis' }), ev('tool_start', { toolUseId: 't1', tool: 'Write', summary: 'a.js' }), ev('delta', { text: 'Selesai' })]);
  assert.deepEqual(items.map((i) => i.kind), ['agent', 'tool', 'agent']);
  assert.equal(items[0].streaming, false);
});

test('reduceChat does not mutate its input', () => {
  const before = run([ev('delta', { text: 'a' })]);
  const snapshot = structuredClone(before);
  reduceChat(before, ev('delta', { text: 'b' }));
  reduceChat(before, ev('status', { to: 'idle' }));
  assert.deepEqual(before, snapshot);
});
