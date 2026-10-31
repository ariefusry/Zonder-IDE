// Right column: tabs, header, messages, composer. Built with DOM nodes and
// textContent only, so agent output can never inject markup.

function renderChat(state, handlers) {
  const tabs = document.getElementById('tabs');
  tabs.replaceChildren();
  for (const a of state.agents) {
    const dot = el('span', { class: 'dot' });
    dot.style.setProperty('--c', STATUS[a.status].color);
    const tab = el('button', { class: 'tab', role: 'tab', 'aria-selected': String(a.id === state.selected) }, dot, a.name);
    tab.addEventListener('click', () => handlers.onSelect(a.id));
    tabs.append(tab);
  }

  const a = state.agents.find((x) => x.id === state.selected);
  const head = document.getElementById('chatHead');
  const msgs = document.getElementById('msgs');
  const input = document.getElementById('input');
  const model = document.getElementById('model');
  head.replaceChildren();
  msgs.replaceChildren();
  model.replaceChildren();

  input.disabled = !a;
  model.hidden = !a;
  document.getElementById('send').disabled = !a;
  document.getElementById('interrupt').hidden = !a || !BUSY.includes(a.status);
  document.getElementById('queue').textContent = '';

  if (!a) {
    msgs.append(el('div', { class: 'empty' },
      el('strong', {}, 'Belum ada agent untuk diajak bicara'),
      'Chat muncul di sini setelah agent dibuat.'));
    return;
  }

  const st = el('span', { class: 'st' }, STATUS[a.status].label);
  st.style.setProperty('--c', STATUS[a.status].color);
  head.append(el('b', {}, a.name), st, el('span', { class: 'role' }, a.role));

  for (const m of state.models.includes(a.model) ? state.models : [...state.models, a.model]) {
    model.append(el('option', { selected: m === a.model ? '' : null }, m));
  }

  const list = state.chats[a.id] || [];
  if (!list.length) {
    msgs.append(el('div', { class: 'empty' },
      el('strong', {}, 'Apa yang ingin dikerjakan?'),
      `Beri ${a.name} tugas pertama.`));
  }
  list.forEach((m, i) => msgs.append(renderItem(a, m, i, handlers)));

  const queued = list.filter((m) => m.queued).length;
  document.getElementById('queue').textContent = queued ? `${queued} pesan menunggu` : '';
  msgs.scrollTop = msgs.scrollHeight;
}

function renderItem(agent, m, i, handlers) {
  if (m.t === 'user') {
    return el('div', { class: 'm-user' }, m.text,
      el('small', {}, m.queued ? `${m.time} · menunggu giliran` : m.time));
  }
  if (m.t === 'agent') {
    const box = el('div', { class: 'm-agent' }, el('div', { class: 'who' }, agent.name), el('p', {}, m.text));
    if (m.code) box.append(el('pre', { class: 'code' }, m.code));
    return box;
  }
  if (m.t === 'tool') {
    const detail = el('div', { class: 'tool-detail', id: `td${i}`, hidden: '' }, m.detail);
    const row = el('button', { class: 'tool', 'aria-expanded': 'false', 'aria-controls': `td${i}` },
      el('span', { class: 'tag' }, m.tag), el('span', { class: 'sum' }, m.sum));
    row.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      row.setAttribute('aria-expanded', String(!detail.hidden));
    });
    return el('div', {}, row, detail);
  }
  if (m.t === 'approval') {
    const row = el('div', { class: 'row' });
    for (const [decision, label] of [['once', 'Izinkan sekali'], ['session', 'Izinkan untuk sesi ini'], ['deny', 'Tolak']]) {
      const b = el('button', { class: 'btn' }, label);
      b.addEventListener('click', () => handlers.onApproval(agent.id, i, decision));
      row.append(b);
    }
    return el('div', { class: 'approval', role: 'group', 'aria-label': 'Permintaan izin' },
      el('h3', {}, 'Izin dibutuhkan'), el('pre', {}, m.command), el('div', { class: 'why' }, m.why), row);
  }
  return el('div', { class: 'resolved' }, m.text);
}
