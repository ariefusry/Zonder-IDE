// Renderer entry: state, mock data, and event wiring. Loaded after
// render-message.js, sidebar.js and chat.js; their helpers are used at call time.

const STATUS = {
  starting: { label: 'memulai', color: 'var(--st-idle)' },
  idle: { label: 'diam', color: 'var(--st-idle)' },
  thinking: { label: 'berpikir', color: 'var(--st-thinking)' },
  working: { label: 'bekerja', color: 'var(--st-working)' },
  testing: { label: 'menguji', color: 'var(--st-testing)' },
  approval: { label: 'menunggu izin', color: 'var(--st-approval)' },
  done: { label: 'selesai', color: 'var(--st-done)' },
  error: { label: 'error', color: 'var(--st-error)' },
  stopped: { label: 'berhenti', color: 'var(--st-idle)' },
};
const BUSY = ['thinking', 'working', 'testing'];
const ACTIVE = [...BUSY, 'approval'];
// Mirrors CLAUDE_MODELS in claude-agent.js; main rejects anything else.
const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'];
// Event types main writes to history; used to drop live duplicates of history.
const PERSISTED = ['message', 'tool_start', 'tool_end', 'error', 'exit'];

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

// Sample chat content for layout work only (?mock / ZONDER_MOCK=1), written as
// agent events so it goes through the same reducer as real ones. The sample
// agents come from the main-process store; the toolbar says it is sample data.
const MOCK_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'];
const MOCK_TS = new Date().setHours(14, 33, 0, 0);
const MOCK_EVENTS = {
  a1: [
    { type: 'message', role: 'agent', text: 'Saya mulai dari test suite untuk modul auth.' },
    { type: 'message', role: 'user', text: 'Tambahkan juga kasus token kedaluwarsa.', ts: MOCK_TS },
    { type: 'message', role: 'agent', text: "Siap. Menulis kasusnya:\n```ts\nit('rejects expired token', async () => {\n  const token = sign({}, secret, { expiresIn: -1 });\n  await assert.rejects(verify(token));\n});\n```" },
    { type: 'tool_start', toolUseId: 'm1', tool: 'Write', summary: 'src/auth/auth.test.ts' },
    { type: 'tool_end', toolUseId: 'm1', isError: false, output: 'File created successfully at: src/auth/auth.test.ts' },
    { type: 'tool_start', toolUseId: 'm2', tool: 'Bash', summary: 'npm run test:auth' },
  ],
  a2: [
    { type: 'message', role: 'user', text: 'Tambahkan validasi input untuk form daftar.', ts: MOCK_TS - 780000 },
    { type: 'message', role: 'agent', text: 'Saya pakai zod untuk skema validasi. Paketnya belum terpasang.' },
    { type: 'approval_request', requestId: 'mock-r1', tool: 'Bash', summary: 'npm install zod', reason: 'Memasang paket selalu bertanya.', grantable: false },
  ],
  a3: [
    { type: 'message', role: 'user', text: 'Review perubahan di cabang zonder/raka.', ts: MOCK_TS - 480000 },
    { type: 'tool_start', toolUseId: 'm3', tool: 'Bash', summary: 'git diff main...HEAD' },
    { type: 'tool_end', toolUseId: 'm3', isError: false, output: ' src/auth/verify.ts | 12 ++++++----\n 1 file changed, 6 insertions(+), 6 deletions(-)' },
    { type: 'message', role: 'agent', text: 'Masih membaca perubahan. Belum ada temuan.' },
  ],
  a4: [],
};

const mock = new URLSearchParams(location.search).has('mock');
const state = {
  loading: true,
  error: null,
  mock,
  agents: [],
  chats: {},
  queue: {},
  expanded: new Set(),
  answering: new Set(),
  models: [],
  selected: null,
  // Last /models result from main; never holds the key.
  router: null,
};

const handlers = {
  onSelect: select,
  onApproval: answerApproval,
  onToggleTool: toggleTool,
  onModel: changeModel,
  onStop: openStopDialog,
  onResume: resumeAgent,
};

function chat(id) {
  if (!state.chats[id]) state.chats[id] = { items: [], loaded: false, loading: false, error: null, buffer: [] };
  return state.chats[id];
}

function renderChrome() {
  renderSidebar(state, select);
  renderTabs(state, handlers);
  renderHead(state, handlers);
  renderComposer(state, handlers);

  const note = document.getElementById('centerNote');
  note.replaceChildren();
  if (state.loading) {
    note.append('Memuat agent...');
  } else if (state.error) {
    note.append(el('h1', {}, 'Agent gagal dimuat'), state.error);
  } else if (!state.agents.length) {
    note.append(el('h1', {}, 'Apa yang ingin dikerjakan?'), 'Klik Spawn Agent untuk membuat agent pertama.');
  }
}

function render() {
  renderChrome();
  renderMessages(state, handlers);
}

function select(id) {
  state.selected = id;
  const c = chat(id);
  if (!c.loaded && !c.loading) loadHistory(id);
  render();
  document.getElementById('msgs').scrollTop = document.getElementById('msgs').scrollHeight;
}

// History first, then open approval cards, then live events that arrived while
// loading. A live event that is also in history is the same object main
// stored, so its JSON matches exactly.
async function loadHistory(id) {
  const c = chat(id);
  c.loading = true;
  try {
    let items = [];
    if (mock && MOCK_EVENTS[id]) {
      items = MOCK_EVENTS[id].map((e) => ({ agentId: id, ...e })).reduce(reduceChat, []);
    } else {
      const { events, pending } = await window.zonder.getHistory(id);
      const seen = new Set(events.map((e) => JSON.stringify(e)));
      const cards = new Set(pending.map((p) => p.requestId));
      items = [...events, ...pending].reduce(reduceChat, []);
      for (const e of c.buffer) {
        if (PERSISTED.includes(e.type) && seen.has(JSON.stringify(e))) continue;
        if (e.type === 'approval_request' && cards.has(e.requestId)) continue;
        items = reduceChat(items, e);
      }
    }
    c.items = items;
    c.error = null;
  } catch (err) {
    c.error = err.message;
  }
  c.buffer = [];
  c.loading = false;
  c.loaded = !c.error;
  if (state.selected === id) renderMessages(state, handlers);
}

function addLocal(id, evt) {
  const c = chat(id);
  c.items = reduceChat(c.items, { agentId: id, ts: Date.now(), ...evt });
  if (state.selected === id) renderMessages(state, handlers);
}

function toggleTool(toolUseId) {
  if (state.expanded.has(toolUseId)) state.expanded.delete(toolUseId);
  else state.expanded.add(toolUseId);
  renderMessages(state, handlers);
}

function answerApproval(agentId, requestId, decision) {
  if (mock) {
    addLocal(agentId, { type: 'approval_resolved', requestId, decision });
    return;
  }
  state.answering.add(requestId);
  renderMessages(state, handlers);
  // The card closes when main sends approval_resolved.
  window.zonder.respondApproval(requestId, decision).catch((err) => {
    state.answering.delete(requestId);
    addLocal(agentId, { type: 'error', message: `Jawaban izin gagal dikirim: ${err.message}` });
  });
}

function changeModel(agentId, model) {
  window.zonder.setModel(agentId, model).catch((err) => {
    modelKey = null;
    renderComposer(state, handlers);
    addLocal(agentId, { type: 'error', message: `Model gagal diganti: ${err.message}` });
  });
}

async function resumeAgent(a) {
  if (state.resuming) return;
  state.resuming = a.id;
  renderHead(state, handlers);
  try {
    await window.zonder.resumeAgent(a.id);
  } catch (err) {
    addLocal(a.id, { type: 'error', message: `Agent gagal dilanjutkan: ${ipcMessage(err)}` });
  }
  state.resuming = null;
  renderChrome();
}

function removeAgent(id) {
  state.agents = state.agents.filter((a) => a.id !== id);
  delete state.chats[id];
  delete state.queue[id];
  if (state.selected === id) {
    state.selected = null;
    if (state.agents.length) select(state.agents[0].id);
  }
  render();
}

function onSpawned(record) {
  if (!state.agents.some((a) => a.id === record.id)) state.agents.push(record);
  select(record.id);
  document.getElementById('input').focus();
}

let refreshing = null;
// An event for an agent the list does not have yet (spawned after load): fetch the list again.
function refreshAgents() {
  refreshing ??= window.zonder.listAgents().then((list) => {
    for (const rec of list) if (!state.agents.some((a) => a.id === rec.id)) state.agents.push(rec);
    if (!state.selected && state.agents.length) select(state.agents[0].id);
    else renderChrome();
  }).catch(() => {}).finally(() => { refreshing = null; });
}

// Statuses, models and queues belong to main; the renderer only mirrors its events.
function onAgentEvent(evt) {
  if (evt.type === 'agent_removed') {
    removeAgent(evt.agentId);
    return;
  }
  const a = state.agents.find((x) => x.id === evt.agentId);
  if (!a) refreshAgents();
  if (evt.type === 'status' && a) a.status = evt.to;
  if (evt.type === 'model' && a) a.model = evt.model;
  if (evt.type === 'queue') state.queue[evt.agentId] = evt.count;
  if (evt.type === 'approval_resolved') state.answering.delete(evt.requestId);

  const c = chat(evt.agentId);
  let changed = false;
  if (c.loaded) {
    const before = c.items;
    c.items = reduceChat(c.items, evt);
    changed = before !== c.items;
  } else if (evt.type !== 'delta') {
    // Deltas are dropped: the full message that replaces them is in history.
    c.buffer.push(evt);
  }

  const shown = state.selected === evt.agentId;
  if (evt.type === 'delta') {
    if (shown && changed && !updateStream(state)) renderMessages(state, handlers);
    return;
  }
  if (['status', 'model', 'queue'].includes(evt.type)) renderChrome();
  if (shown && (changed || evt.type === 'queue')) renderMessages(state, handlers);
}

document.getElementById('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('input');
  const text = input.value.trim();
  const a = state.agents.find((x) => x.id === state.selected);
  if (!text || !a) return;
  if (mock) {
    addLocal(a.id, { type: 'message', role: 'user', text });
    input.value = '';
    return;
  }
  // The bubble appears when the agent's message event comes back.
  window.zonder.sendMessage(a.id, text).then(
    () => { if (input.value.trim() === text) input.value = ''; },
    (err) => addLocal(a.id, { type: 'error', message: `Pesan tidak terkirim: ${err.message}` }),
  );
});

document.getElementById('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('composer').requestSubmit();
  }
});

document.getElementById('interrupt').addEventListener('click', () => {
  const id = state.selected;
  if (mock) {
    addLocal(id, { type: 'error', message: 'Agent contoh tidak bisa diinterupsi.' });
    return;
  }
  window.zonder.interruptAgent(id).catch((err) => addLocal(id, { type: 'error', message: `Interupsi gagal: ${err.message}` }));
});

function setRouter(r) {
  state.router = r;
  renderChrome();
}

function refreshRouter() {
  return window.zonder.listModels().then(setRouter, (err) => setRouter({ baseUrl: state.router?.baseUrl ?? null, hasKey: state.router?.hasKey ?? false, connected: false, latencyMs: null, models: [], error: err.message }));
}

async function load() {
  initSpawnModal({ onSpawned, onRouter: setRouter });
  initSettings();
  refreshRouter();
  initStopDialog();
  startOffice(document.getElementById('office'), {
    getAgents: () => state.agents,
    getSelected: () => state.selected,
    onSelect: select,
  });
  renderChrome();
  try {
    window.zonder.subscribeAgentEvents(onAgentEvent);
    state.agents = await window.zonder.listAgents();
    if (mock) {
      state.models = MOCK_MODELS;
      document.getElementById('sampleNote').hidden = false;
    }
  } catch (err) {
    state.error = err.message;
  }
  state.loading = false;
  if (state.agents.length) select(state.agents[0].id);
  else render();
  if (!mock) checkOrphans();
}

load();
