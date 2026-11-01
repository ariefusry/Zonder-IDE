// Right column: tabs, header, messages, composer. Built with DOM nodes and
// textContent only, so agent output can never inject markup. Parts render
// separately: a status change must not rebuild the message list, and a text
// delta only touches the bubble it grows.

const DECIDED = { once: 'Diizinkan sekali', session: 'Diizinkan untuk sesi ini', deny: 'Ditolak' };
const TOOL_STATE = { running: 'berjalan', error: 'gagal' };

function selectedAgent(state) {
  return state.agents.find((x) => x.id === state.selected);
}

function renderTabs(state, handlers) {
  const tabs = document.getElementById('tabs');
  tabs.replaceChildren();
  for (const a of state.agents) {
    const dot = el('span', { class: 'dot' });
    dot.style.setProperty('--c', STATUS[a.status].color);
    const tab = el('button', { class: 'tab', role: 'tab', 'aria-selected': String(a.id === state.selected) }, dot, a.name);
    tab.addEventListener('click', () => handlers.onSelect(a.id));
    tabs.append(tab);
  }
}

function renderHead(state, handlers) {
  const a = selectedAgent(state);
  const head = document.getElementById('chatHead');
  head.replaceChildren();
  if (!a) return;
  const st = el('span', { class: 'st' }, STATUS[a.status].label);
  st.style.setProperty('--c', STATUS[a.status].color);
  head.append(el('b', {}, a.name), st, el('span', { class: 'role' }, a.role));
  if (!a.sample) {
    const stop = el('button', { class: 'btn btn-stop', 'aria-haspopup': 'dialog' }, a.status === 'stopped' ? 'Bersihkan' : 'Hentikan');
    stop.addEventListener('click', () => handlers.onStop(a));
    head.append(stop);
  }
}

let modelKey = null;

function renderComposer(state, handlers) {
  const a = selectedAgent(state);
  const input = document.getElementById('input');
  const model = document.getElementById('model');
  // The input stays enabled during a turn: messages sent then are queued.
  input.disabled = !a;
  document.getElementById('send').disabled = !a;
  document.getElementById('interrupt').hidden = !a || !BUSY.includes(a.status);
  const queued = a ? state.queue[a.id] || 0 : 0;
  document.getElementById('queue').textContent = queued ? `${queued} pesan menunggu` : '';

  model.hidden = !a;
  if (!a) return;
  // Rebuild the select only when its content changes, so an open dropdown survives events.
  const models = state.mock ? state.models : a.kind === 'router' ? state.router?.models ?? [] : CLAUDE_MODELS;
  const key = `${a.id}|${a.model}|${state.mock}|${models.join(',')}`;
  if (key === modelKey) return;
  modelKey = key;
  model.replaceChildren();
  for (const m of models.includes(a.model) ? models : [...models, a.model]) {
    model.append(el('option', { selected: m === a.model ? '' : null }, m));
  }
  model.disabled = state.mock;
  model.title = state.mock ? 'Agent contoh: model tidak bisa diganti' : 'Ganti model untuk pesan berikutnya';
  model.onchange = () => handlers.onModel(a.id, model.value);
}

function renderMessages(state, handlers) {
  const a = selectedAgent(state);
  const msgs = document.getElementById('msgs');
  // Follow new messages only when the reader is already at the bottom.
  const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
  msgs.replaceChildren();

  if (!a) {
    msgs.append(el('div', { class: 'empty' },
      el('strong', {}, 'Belum ada agent untuk diajak bicara'),
      'Chat muncul di sini setelah agent dibuat.'));
    return;
  }
  const c = state.chats[a.id];
  if (!c || !c.loaded) {
    msgs.append(el('div', { class: 'empty' }, c?.error ? `Riwayat gagal dimuat: ${c.error}` : 'Memuat riwayat...'));
    return;
  }
  if (!c.items.length) {
    msgs.append(el('div', { class: 'empty' },
      el('strong', {}, 'Apa yang ingin dikerjakan?'),
      `Beri ${a.name} tugas pertama.`));
    return;
  }

  // The last N user messages are still in the agent's queue.
  let waiting = state.queue[a.id] || 0;
  const waitingAt = new Set();
  for (let i = c.items.length - 1; i >= 0 && waiting > 0; i--) {
    if (c.items[i].kind === 'user') {
      waitingAt.add(i);
      waiting--;
    }
  }
  c.items.forEach((m, i) => msgs.append(renderItem(state, a, m, waitingAt.has(i), handlers)));
  if (atBottom) msgs.scrollTop = msgs.scrollHeight;
}

// Fast path for a text delta: replace only the open bubble's body.
function updateStream(state) {
  const a = selectedAgent(state);
  const last = a && state.chats[a.id]?.items.at(-1);
  const node = document.getElementById('msgs').lastElementChild;
  if (!last || last.kind !== 'agent' || !node?.classList.contains('m-agent')) return false;
  const msgs = document.getElementById('msgs');
  const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
  node.replaceWith(renderAgent(a, last));
  if (atBottom) msgs.scrollTop = msgs.scrollHeight;
  return true;
}

function clock(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderAgent(agent, m) {
  const box = el('div', { class: m.streaming ? 'm-agent streaming' : 'm-agent' },
    el('div', { class: 'who' }, m.streaming ? `${agent.name} · menulis` : agent.name));
  for (const b of m.blocks) {
    box.append(b.type === 'code' ? el('pre', { class: 'code', 'data-lang': b.lang || null }, b.text) : el('p', {}, b.text));
  }
  return box;
}

function renderItem(state, agent, m, waiting, handlers) {
  if (m.kind === 'user') {
    const time = clock(m.ts);
    return el('div', { class: 'm-user' }, m.text,
      el('small', {}, waiting ? [time, 'menunggu giliran'].filter(Boolean).join(' · ') : time));
  }
  if (m.kind === 'agent') return renderAgent(agent, m);
  if (m.kind === 'tool') {
    const id = `td-${m.toolUseId}`;
    const open = state.expanded.has(m.toolUseId);
    const detail = el('div', { class: 'tool-detail', id, hidden: open ? null : '' }, m.output || (m.state === 'running' ? 'Belum ada keluaran.' : 'Tanpa keluaran.'));
    const row = el('button', { class: `tool ${m.state}`, 'aria-expanded': String(open), 'aria-controls': id },
      el('span', { class: 'tag' }, m.tag), el('span', { class: 'sum' }, m.summary));
    if (TOOL_STATE[m.state]) row.append(el('span', { class: 'state' }, TOOL_STATE[m.state]));
    row.addEventListener('click', () => handlers.onToggleTool(m.toolUseId));
    return el('div', {}, row, detail);
  }
  if (m.kind === 'approval') {
    if (m.resolved) {
      const text = `${DECIDED[m.resolved]}: ${m.summary}`;
      return el('div', { class: 'resolved' }, state.mock ? `${text} (contoh, tidak dikirim ke agent)` : text);
    }
    const row = el('div', { class: 'row' });
    const busy = state.answering.has(m.requestId);
    for (const c of m.choices) {
      const b = el('button', { class: 'btn', disabled: busy ? '' : null }, c.label);
      b.addEventListener('click', () => handlers.onApproval(agent.id, m.requestId, c.decision));
      row.append(b);
    }
    return el('div', { class: 'approval', role: 'group', 'aria-label': `Permintaan izin: ${m.tool}` },
      el('h3', {}, `Izin dibutuhkan · ${m.tool}`), el('pre', {}, m.summary), el('div', { class: 'why' }, m.reason), row);
  }
  if (m.kind === 'error') return el('div', { class: 'm-error', role: 'status' }, m.text);
  return el('div', { class: 'resolved' }, m.text ?? '');
}
