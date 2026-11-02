const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentStore } = require('../src/main/store.js');
const { Approvals } = require('../src/main/approvals.js');
const { RouterAgent, MAX_TOOL_ROUNDS } = require('../src/main/agents/router-agent.js');

const enc = new TextEncoder();
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

// One scripted model reply as SSE: {text} and/or {calls: [{id, name, args}]}.
function replyChunks({ text, calls, model }) {
  const chunks = [];
  if (text) for (const part of text.match(/.{1,4}/gs)) chunks.push(sse({ ...(model ? { model } : {}), choices: [{ index: 0, delta: { content: part } }] }));
  (calls || []).forEach((c, i) => {
    chunks.push(sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: '' } }] } }] }));
    chunks.push(sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: c.args } }] } }] }));
  });
  chunks.push('data: [DONE]\n\n');
  return chunks;
}

// fetch that answers /models and plays `script` (an array, or a function of the
// request number) for /chat/completions. Request bodies land in `requests`.
function fakeRouter(script) {
  const requests = [];
  let models = 0;
  const fetch = async (url, init) => {
    if (url.endsWith('/models')) {
      models++;
      return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 });
    }
    const body = JSON.parse(init.body);
    requests.push(body);
    const n = requests.length - 1;
    const step = typeof script === 'function' ? script(n, body) : script[n];
    if (step instanceof Error) throw step;
    if (step?.wait) await step.wait(init.signal);
    const stream = new ReadableStream({
      start(ctrl) {
        for (const c of replyChunks(step ?? { text: 'selesai' })) ctrl.enqueue(enc.encode(c));
        ctrl.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  return { fetch, requests, modelCalls: () => models };
}

function setup({ role = 'Junior Developer', script = [], key = 'k-test', agent: agentOpts = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-ra-'));
  const repo = path.join(root, 'repo');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(repo);
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, 'a.txt'), 'isi a');
  const store = new AgentStore();
  const approvals = new Approvals({ store });
  const record = store.add({ id: 'r1', name: 'Rio', role, kind: 'router', model: 'm1', persona: 'Persona uji.', workspace: repo, worktreePath: wt, status: 'stopped' });
  const events = [];
  store.subscribe((e) => events.push(e));
  const persisted = [];
  const router = fakeRouter(script);
  const agent = new RouterAgent({
    record, store, approvals,
    persistence: { appendEvent: (_id, e) => persisted.push(e) },
    getKey: async () => key,
    baseUrl: 'https://router.test/v1',
    fetch: router.fetch,
    doneIdleMs: 20,
    ...agentOpts,
  });
  const of = (type) => events.filter((e) => e.type === type);
  const statuses = () => of('status').map((e) => e.to);
  return { root, repo, wt, store, approvals, record, events, persisted, router, agent, of, statuses, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await wait(5);
  }
}

// Every assistant tool_calls entry must be answered by role:'tool' messages
// for each id before anything else, or the next request is rejected.
function assertValidHistory(messages) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.tool_calls) continue;
    const ids = m.tool_calls.map((c) => c.id);
    const answers = messages.slice(i + 1, i + 1 + ids.length);
    assert.deepEqual(answers.map((a) => a.role), ids.map(() => 'tool'), `tool_calls at ${i} not answered`);
    assert.deepEqual(answers.map((a) => a.tool_call_id), ids);
  }
}

test('start checks the router: idle when /models answers', async () => {
  const s = setup();
  try {
    await s.agent.start();
    assert.deepEqual(s.statuses(), ['starting', 'idle']);
    assert.equal(s.router.modelCalls(), 1);
  } finally {
    s.cleanup();
  }
});

test('start without a key or with the router unreachable ends in error', async () => {
  const a = setup({ key: null });
  const b = setup({ agent: { fetch: async () => { throw new TypeError('fetch failed'); } } });
  try {
    await a.agent.start();
    assert.equal(a.record.status, 'error');
    assert.match(a.of('error')[0].message, /Kunci 9router/);
    await b.agent.start();
    assert.equal(b.record.status, 'error');
    assert.equal(b.of('error')[0].message, 'Router offline');
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('a text reply streams deltas, then a message, then done and idle', async () => {
  const s = setup({ script: [{ text: 'Halo dari router' }] });
  try {
    await s.agent.start();
    s.agent.send('hai');
    await s.agent.turn;
    assert.equal(s.of('delta').map((e) => e.text).join(''), 'Halo dari router');
    assert.deepEqual(s.of('message').map((e) => [e.role, e.text]), [['user', 'hai'], ['agent', 'Halo dari router']]);
    const req = s.router.requests[0];
    assert.equal(req.model, 'm1');
    assert.equal(req.messages[0].role, 'system');
    assert.match(req.messages[0].content, /Persona uji\./);
    assert.match(req.messages[0].content, new RegExp(s.wt.replace(/\\/g, '\\\\')));
    assert.deepEqual(req.messages.slice(1), [{ role: 'user', content: 'hai' }]);
    assert.deepEqual(req.tools.map((t) => t.function.name), ['read_file', 'list_dir', 'write_file', 'run_command']);
    await until(() => s.record.status === 'idle');
    assert.deepEqual(s.statuses(), ['starting', 'idle', 'thinking', 'done', 'idle']);
    assert.deepEqual(s.persisted.map((e) => e.type), ['message', 'message']);
  } finally {
    s.cleanup();
  }
});

test('read_file runs locally and its result goes back as role:tool', async () => {
  const s = setup({ script: [{ calls: [{ id: 'c1', name: 'read_file', args: '{"path":"a.txt"}' }] }, { text: 'Isinya isi a.' }] });
  try {
    await s.agent.start();
    s.agent.send('baca a.txt');
    await s.agent.turn;
    assert.deepEqual(s.of('tool_start').map((e) => [e.toolUseId, e.tool, e.summary]), [['c1', 'read_file', 'a.txt']]);
    assert.deepEqual(s.of('tool_end').map((e) => [e.toolUseId, e.isError, e.output]), [['c1', false, 'isi a']]);
    const msgs = s.router.requests[1].messages;
    assertValidHistory(msgs);
    assert.deepEqual(msgs.at(-1), { role: 'tool', tool_call_id: 'c1', content: 'isi a' });
    assert.ok(s.statuses().includes('working'));
    assert.equal(s.of('approval_request').length, 0);
  } finally {
    s.cleanup();
  }
});

test('malformed tool_calls arguments give "invalid arguments" and the loop continues', async () => {
  const s = setup({ script: [{ calls: [{ id: 'c1', name: 'read_file', args: '{"path": "a.txt"' }] }, { text: 'Maaf.' }] });
  try {
    await s.agent.start();
    s.agent.send('baca');
    await s.agent.turn;
    assert.equal(s.router.requests.length, 2);
    const tool = s.router.requests[1].messages.at(-1);
    assert.equal(tool.role, 'tool');
    assert.match(tool.content, /invalid arguments/);
    assert.equal(s.of('tool_end')[0].isError, true);
    assert.equal(s.of('message').at(-1).text, 'Maaf.');
  } finally {
    s.cleanup();
  }
});

test('an unknown tool is denied as a tool result, without a card', async () => {
  const s = setup({ script: [{ calls: [{ id: 'c1', name: 'delete_everything', args: '{}' }] }, { text: 'ok' }] });
  try {
    await s.agent.start();
    s.agent.send('x');
    await s.agent.turn;
    const tool = s.router.requests[1].messages.at(-1);
    assert.equal(tool.tool_call_id, 'c1');
    assert.match(tool.content, /Ditolak: tool tidak dikenal: delete_everything/);
    assert.equal(s.of('approval_request').length, 0);
  } finally {
    s.cleanup();
  }
});

test(`the loop stops after ${MAX_TOOL_ROUNDS} tool rounds with an error, and the next turn sends a valid history`, async () => {
  const s = setup({ script: (n) => (n < 26 ? { calls: [{ id: `c${n}`, name: 'list_dir', args: '{}' }] } : { text: 'lanjut' }) });
  try {
    assert.equal(MAX_TOOL_ROUNDS, 25);
    await s.agent.start();
    s.agent.send('loop terus');
    await s.agent.turn;
    assert.equal(s.of('tool_end').length, 25);
    assert.equal(s.router.requests.length, 26);
    assert.match(s.of('error').at(-1).message, /25/);
    assert.equal(s.record.status, 'idle');

    s.agent.send('lagi');
    await s.agent.turn;
    const msgs = s.router.requests[26].messages;
    assertValidHistory(msgs);
    assert.deepEqual(msgs.at(-1), { role: 'user', content: 'lagi' });
  } finally {
    s.cleanup();
  }
});

test('Reviewer asking run_command is denied without prompting; the reason goes back as role:tool', async () => {
  const s = setup({ role: 'Reviewer', script: [{ calls: [{ id: 'c1', name: 'run_command', args: '{"command":"npm test"}' }] }, { text: 'ok' }] });
  try {
    await s.agent.start();
    s.agent.send('jalankan tes');
    await s.agent.turn;
    assert.equal(s.of('approval_request').length, 0);
    assert.ok(!s.statuses().includes('approval'));
    const tool = s.router.requests[1].messages.at(-1);
    assert.match(tool.content, /Ditolak: Reviewer tidak mendapat akses shell/);
  } finally {
    s.cleanup();
  }
});

test('write_file to ..\\x is a hard deny and nothing lands outside the worktree', async () => {
  const s = setup({ role: 'Senior Developer', script: [{ calls: [{ id: 'c1', name: 'write_file', args: JSON.stringify({ path: '..\\x', content: 'kabur' }) }] }, { text: 'ok' }] });
  try {
    await s.agent.start();
    s.agent.send('tulis');
    await s.agent.turn;
    assert.equal(s.of('approval_request').length, 0);
    assert.match(s.router.requests[1].messages.at(-1).content, /Ditolak: Diblokir: \.\.\\x ada di luar worktree agent/);
    assert.equal(fs.existsSync(path.join(s.root, 'x')), false);
  } finally {
    s.cleanup();
  }
});

test('Junior write_file waits for the card; allow once writes the file', async () => {
  const s = setup({ script: [{ calls: [{ id: 'c1', name: 'write_file', args: '{"path":"b.txt","content":"hai"}' }] }, { text: 'sudah' }] });
  try {
    await s.agent.start();
    s.agent.send('tulis b.txt');
    await until(() => s.of('approval_request').length === 1);
    const card = s.of('approval_request')[0];
    assert.equal(card.tool, 'write_file');
    assert.equal(card.summary, 'b.txt');
    assert.equal(s.record.status, 'approval');
    s.agent.respond(card.requestId, 'once');
    await s.agent.turn;
    assert.equal(fs.readFileSync(path.join(s.wt, 'b.txt'), 'utf8'), 'hai');
    assert.match(s.router.requests[1].messages.at(-1).content, /File ditulis: b\.txt/);
  } finally {
    s.cleanup();
  }
});

test('a recognised test command shows testing while it runs', async () => {
  const ran = [];
  const s = setup({
    role: 'Senior Developer',
    script: [{ calls: [{ id: 'c1', name: 'run_command', args: '{"command":"npm test"}' }] }, { text: 'lulus' }],
    agent: { toolCtx: { execFile: (_f, args, _o, cb) => { ran.push(args.at(-1)); cb(null, 'pass 3', ''); return { pid: 1 }; } } },
  });
  try {
    await s.agent.start();
    s.agent.send('tes');
    await s.agent.turn;
    assert.deepEqual(ran, ['"npm test"']);
    assert.ok(s.statuses().includes('testing'));
    assert.match(s.router.requests[1].messages.at(-1).content, /pass 3/);
  } finally {
    s.cleanup();
  }
});

test('router unreachable mid-turn: error status and "Router offline"; the next send retries', async () => {
  const s = setup({ script: [new TypeError('fetch failed'), { text: 'kembali' }] });
  try {
    await s.agent.start();
    s.agent.send('hai');
    await s.agent.turn;
    assert.equal(s.of('error').at(-1).message, 'Router offline');
    assert.equal(s.record.status, 'error');
    s.agent.send('coba lagi');
    await s.agent.turn;
    assert.equal(s.of('message').at(-1).text, 'kembali');
    assert.deepEqual(s.statuses().slice(-4), ['error', 'starting', 'thinking', 'done']);
  } finally {
    s.cleanup();
  }
});

test('HTTP errors are shown with their status and the agent goes back to idle', async () => {
  const s = setup({
    agent: {
      fetch: async (url) => (url.endsWith('/models') ? new Response('{"data":[]}') : new Response('quota habis', { status: 429 })),
    },
  });
  try {
    await s.agent.start();
    s.agent.send('hai');
    await s.agent.turn;
    assert.match(s.of('error').at(-1).message, /429.*quota habis/);
    assert.equal(s.record.status, 'idle');
  } finally {
    s.cleanup();
  }
});

test('a message sent during a turn is queued and runs next', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = setup({ script: [{ text: 'satu', wait: () => gate }, { text: 'dua' }] });
  try {
    await s.agent.start();
    s.agent.send('pertama');
    await until(() => s.router.requests.length === 1);
    s.agent.send('kedua');
    assert.equal(s.of('message').at(-1).queued, true);
    assert.deepEqual(s.of('queue').map((e) => e.count), [1]);
    release();
    await until(() => s.router.requests.length === 2);
    await s.agent.turn;
    assert.deepEqual(s.router.requests[1].messages.slice(-3).map((m) => [m.role, m.content]), [['user', 'pertama'], ['assistant', 'satu'], ['user', 'kedua']]);
  } finally {
    s.cleanup();
  }
});

test('interrupt while a card is open cancels it, goes idle, and keeps the history valid', async () => {
  const s = setup({ script: [{ calls: [{ id: 'c1', name: 'write_file', args: '{"path":"b.txt","content":"x"}' }] }, { text: 'ok' }] });
  try {
    await s.agent.start();
    s.agent.send('tulis');
    await until(() => s.of('approval_request').length === 1);
    s.agent.interrupt();
    await s.agent.turn;
    assert.equal(s.record.status, 'idle');
    assert.equal(fs.existsSync(path.join(s.wt, 'b.txt')), false);
    assert.equal(s.of('approval_resolved')[0].decision, 'deny');
    s.agent.send('lagi');
    await s.agent.turn;
    assertValidHistory(s.router.requests.at(-1).messages);
  } finally {
    s.cleanup();
  }
});

test('interrupt during streaming aborts the request and goes idle without an error', async () => {
  const s = setup({
    script: [{ wait: (signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason))) }],
  });
  try {
    await s.agent.start();
    s.agent.send('lama');
    await until(() => s.router.requests.length === 1);
    s.agent.interrupt();
    await s.agent.turn;
    assert.equal(s.record.status, 'idle');
    assert.equal(s.of('error').length, 0);
  } finally {
    s.cleanup();
  }
});

test('stop aborts the turn, drops the queue, and ends in stopped', async () => {
  const s = setup({
    script: [{ wait: (signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason))) }],
  });
  try {
    await s.agent.start();
    s.agent.send('lama');
    await until(() => s.router.requests.length === 1);
    s.agent.send('antre');
    await s.agent.stop();
    assert.equal(s.record.status, 'stopped');
    assert.equal(s.router.requests.length, 1);
    assert.throws(() => s.agent.send('lagi'), /belum berjalan/);
  } finally {
    s.cleanup();
  }
});

test('stop during a running command kills it at once and keeps the history valid', async () => {
  const killed = [];
  const s = setup({
    role: 'Senior Developer',
    script: [{ calls: [{ id: 'c1', name: 'run_command', args: '{"command":"npm test"}' }] }],
    agent: { toolCtx: { execFile: () => ({ pid: 321 }), kill: async (pid) => killed.push(pid) } },
  });
  try {
    await s.agent.start();
    s.agent.send('tes');
    await until(() => s.of('tool_start').length === 1 && s.record.status === 'testing');
    const t0 = Date.now();
    await s.agent.stop();
    assert.ok(Date.now() - t0 < 1000);
    assert.deepEqual(killed, [321]);
    assert.equal(s.record.status, 'stopped');
    assertValidHistory(s.agent.messages);
    assert.match(s.agent.messages.at(-1).content, /Dibatalkan/);
  } finally {
    s.cleanup();
  }
});

test('the queue count follows position, also when a queued text repeats the first one', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = setup({ script: [{ text: 'a', wait: () => gate }, { text: 'b' }, { text: 'c' }] });
  try {
    await s.agent.start();
    s.agent.send('lanjut');
    await until(() => s.router.requests.length === 1);
    s.agent.send('lanjut');
    s.agent.send('lanjut');
    release();
    await until(() => s.router.requests.length === 3);
    await s.agent.turn;
    assert.deepEqual(s.of('queue').map((e) => e.count), [1, 2, 1, 0]);
  } finally {
    s.cleanup();
  }
});

test('a baseUrl function is read on every request, so a changed URL applies at once', async () => {
  let url = 'https://router.test/v1';
  const urls = [];
  const s = setup({ script: [{ text: 'a' }, { text: 'b' }], agent: { baseUrl: () => url } });
  const inner = s.router.fetch;
  s.agent.fetch = (u, init) => { urls.push(u); return inner(u, init); };
  try {
    await s.agent.start();
    s.agent.send('satu');
    await s.agent.turn;
    url = 'https://other.test/v1';
    s.agent.send('dua');
    await s.agent.turn;
    assert.deepEqual(urls, ['https://router.test/v1/models', 'https://router.test/v1/chat/completions', 'https://other.test/v1/chat/completions']);
  } finally {
    s.cleanup();
  }
});

test('setModel switches the model for the next request', async () => {
  const s = setup({ script: [{ text: 'a' }] });
  try {
    await s.agent.start();
    s.record.servedModel = 'kr/claude-sonnet-4.5';
    s.agent.setModel('m2');
    assert.equal(s.of('model')[0].model, 'm2');
    // The old answer's model says nothing about the new choice.
    assert.equal(s.record.servedModel, null);
    s.agent.send('hai');
    await s.agent.turn;
    assert.equal(s.router.requests[0].model, 'm2');
  } finally {
    s.cleanup();
  }
});

test('start after a relaunch replays stored history into the first request, once', async () => {
  const history = [
    { type: 'message', role: 'user', text: 'nama saya Arief' },
    { type: 'message', role: 'agent', text: 'Halo Arief.' },
  ];
  const s = setup({ agent: { persistence: { appendEvent: () => {}, loadHistory: () => history } } });
  await s.agent.start();
  s.agent.send('siapa nama saya?');
  await until(() => s.router.requests.length === 1 && s.record.status !== 'thinking');
  assert.deepEqual(s.router.requests[0].messages.slice(1), [
    { role: 'user', content: 'nama saya Arief' },
    { role: 'assistant', content: 'Halo Arief.' },
    { role: 'user', content: 'siapa nama saya?' },
  ]);
  await s.agent.stop();
  await s.agent.start();
  s.agent.send('lagi');
  await until(() => s.router.requests.length === 2);
  assert.equal(s.router.requests[1].messages.filter((m) => m.content === 'nama saya Arief').length, 1);
  await s.agent.stop();
  s.cleanup();
});

test('system prompt lists name + description of the role skills and mentions load_skill; no skills -> no skill section and no load_skill tool', async () => {
  const skills = [
    { id: 'user:ui', name: 'ui', description: 'Aturan UI tanpa slop.', source: 'user', dir: 'C:\\x\\ui' },
    { id: 'kit:deck', name: 'deck', description: 'Membuat slide.', source: 'kit', dir: 'C:\\x\\deck' },
  ];
  const s = setup({ script: [{ text: 'ok' }], agent: { listSkills: () => skills } });
  const t = setup({ script: [{ text: 'ok' }], agent: { listSkills: () => skills } });
  try {
    s.record.rolePolicy = { name: 'Designer', write: 'ask', shell: 'ask', skills: ['user:ui'], disableSkills: false };
    await s.agent.start();
    s.agent.send('hai');
    await s.agent.turn;
    const req = s.router.requests[0];
    assert.match(req.messages[0].content, /load_skill/);
    assert.match(req.messages[0].content, /- ui: Aturan UI tanpa slop\./);
    assert.doesNotMatch(req.messages[0].content, /deck/);
    assert.ok(req.tools.some((x) => x.function.name === 'load_skill'));

    t.record.rolePolicy = { name: 'Junior Developer', write: 'ask', shell: 'ask', skills: [], disableSkills: false };
    await t.agent.start();
    t.agent.send('hai');
    await t.agent.turn;
    const plain = t.router.requests[0];
    assert.doesNotMatch(plain.messages[0].content, /load_skill|Skill/);
    assert.ok(!plain.tools.some((x) => x.function.name === 'load_skill'));
  } finally {
    s.cleanup();
    t.cleanup();
  }
});

test('a load_skill call runs without an approval card and returns the skill text', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-ras-'));
  fs.writeFileSync(path.join(root, 'SKILL.md'), 'Aturan: satu aksen.');
  const skills = [{ id: 'user:ui', name: 'ui', description: 'Aturan UI.', source: 'user', dir: root }];
  const s = setup({
    role: 'Reviewer',
    script: [{ calls: [{ id: 'c1', name: 'load_skill', args: '{"name":"ui"}' }] }, { text: 'Satu aksen.' }],
    agent: { listSkills: () => skills },
  });
  try {
    s.record.rolePolicy = { name: 'Reviewer', write: 'deny', shell: 'deny', skills: ['user:ui'], disableSkills: false };
    await s.agent.start();
    s.agent.send('muat skill ui');
    await s.agent.turn;
    assert.deepEqual(s.of('tool_end').map((e) => [e.isError, e.output]), [[false, 'Aturan: satu aksen.']]);
    assert.equal(s.of('approval_request').length, 0);
    assert.deepEqual(s.router.requests[1].messages.at(-1), { role: 'tool', tool_call_id: 'c1', content: 'Aturan: satu aksen.' });
  } finally {
    s.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('maxToolRounds from settings (3) caps the turn at 3 rounds', async () => {
  const s = setup({ script: (n) => (n < 10 ? { calls: [{ id: `c${n}`, name: 'list_dir', args: '{}' }] } : { text: 'ok' }), agent: { limits: () => ({ maxToolRounds: 3, commandTimeoutSec: 60 }) } });
  try {
    await s.agent.start();
    s.agent.send('loop');
    await s.agent.turn;
    assert.equal(s.of('tool_end').length, 3);
    assert.match(s.of('error').at(-1).message, /Batas 3 putaran/);
  } finally {
    s.cleanup();
  }
});

test('commandTimeoutSec 5 reaches the tool as timeoutMs 5000', async () => {
  const seen = [];
  const routerTools = require('../src/main/agents/router-tools.js');
  const tools = { ...routerTools, execTool: async (name, args, ctx) => { seen.push(ctx.timeoutMs); return 'ok'; } };
  const s = setup({ role: 'Senior Developer', script: [{ calls: [{ id: 'c1', name: 'run_command', args: '{"command":"npm test"}' }] }, { text: 'ok' }], agent: { tools, limits: () => ({ maxToolRounds: 25, commandTimeoutSec: 5 }) } });
  try {
    await s.agent.start();
    s.agent.send('tes');
    await s.agent.turn;
    assert.deepEqual(seen, [5000]);
  } finally {
    s.cleanup();
  }
});

test('setEffort applies to the next request without restart; bad values throw', async () => {
  const s = setup({ script: [{ text: 'a' }, { text: 'b' }] });
  try {
    await s.agent.start();
    s.agent.send('satu');
    await s.agent.turn;
    s.agent.setEffort('low');
    s.agent.send('dua');
    await s.agent.turn;
    assert.ok(!('reasoning_effort' in s.router.requests[0]));
    assert.equal(s.router.requests[1].reasoning_effort, 'low');
    assert.equal(s.router.modelCalls(), 1, 'no restart');
    assert.deepEqual(s.of('effort').map(({ effort, pending }) => ({ effort, pending })), [{ effort: 'low', pending: false }]);
    assert.throws(() => s.agent.setEffort('xhigh'), /Effort tidak dikenal/);
  } finally {
    s.cleanup();
  }
});

test('servedModel from the stream lands on the record with one event; the same value next turn emits none', async () => {
  const s = setup({ script: [{ text: 'a', model: 'kr/claude-sonnet-4.5' }, { text: 'b', model: 'kr/claude-sonnet-4.5' }] });
  try {
    await s.agent.start();
    s.agent.send('hai');
    await s.agent.turn;
    assert.equal(s.record.servedModel, 'kr/claude-sonnet-4.5');
    assert.deepEqual(s.of('servedModel').map((e) => [e.agentId, e.model]), [['r1', 'kr/claude-sonnet-4.5']]);
    s.agent.send('lagi');
    await s.agent.turn;
    assert.equal(s.of('servedModel').length, 1);
  } finally {
    s.cleanup();
  }
});

test('a turn whose stream names no model clears servedModel, so no stale logo stays', async () => {
  const s = setup({ script: [{ text: 'a', model: 'cx/gpt-4o' }, { text: 'b' }] });
  try {
    await s.agent.start();
    s.agent.send('hai');
    await s.agent.turn;
    assert.equal(s.record.servedModel, 'cx/gpt-4o');
    s.agent.send('lagi');
    await s.agent.turn;
    assert.equal(s.record.servedModel, null);
    assert.deepEqual(s.of('servedModel').map((e) => e.model), ['cx/gpt-4o', null]);
  } finally {
    s.cleanup();
  }
});
