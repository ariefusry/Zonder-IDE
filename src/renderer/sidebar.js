// Left column: agent cards. Also owns the office legend and status bar count,
// since all three are summaries of the same agent list.

// A role deleted after spawn: flagged on resume by main, or missing from the
// current role list while the agent still runs on its own copy of the rules.
function roleDeleted(state, a) {
  return Boolean(a.roleDeleted || (!a.sample && state.roleNames && a.role && !state.roleNames.has(a.role)));
}

// Agents per repo (layout spec §4.2). Paths on Windows ignore case, so the key
// is lower-cased; sample agents share one group. Newest group first, agents in
// their incoming order.
function groupAgents(agents) {
  const groups = new Map();
  const newest = new Map();
  for (const a of agents) {
    const key = a.sample ? 'sample' : String(a.workspace ?? '').toLowerCase();
    if (!groups.has(key)) {
      const path = a.sample ? null : a.workspace ?? null;
      const name = a.sample ? 'Contoh' : String(path ?? '').split(/[\\/]/).filter(Boolean).pop() || 'Tanpa repo';
      groups.set(key, { key, name, path, agents: [], approvals: 0 });
      newest.set(key, -Infinity);
    }
    const g = groups.get(key);
    g.agents.push(a);
    if (a.status === 'approval') g.approvals++;
    newest.set(key, Math.max(newest.get(key), a.createdAt ?? 0));
  }
  return [...groups.values()].sort((x, y) => newest.get(y.key) - newest.get(x.key));
}

// Collapsed group keys, for this session only.
const collapsedGroups = new Set();

function agentCard(state, a, onSelect) {
  const st = STATUS[a.status];
  const card = el('button', { class: 'agent', role: 'tab', 'aria-selected': String(a.id === state.selected) },
    el('span', { class: 'dot' }),
    el('span', { class: 'nm' }, Models.logoNode(a), el('span', {}, a.name)),
    el('span', { class: 'md' }, Models.modelLine(a)),
    el('span', { class: 'rl' }, roleDeleted(state, a) ? `${a.role}, peran dihapus` : a.role),
    el('span', { class: 'stt' }, a.line ? `${st.label}: ${a.line}` : st.label),
  );
  card.style.setProperty('--c', st.color);
  card.addEventListener('click', () => onSelect(a.id));
  return card;
}

function renderSidebar(state, onSelect) {
  const list = document.getElementById('agentList');
  list.replaceChildren();

  if (state.loading) {
    list.append(el('p', { class: 'empty' }, 'Memuat agent...'));
  } else if (state.error) {
    list.append(el('p', { class: 'empty' }, `Gagal memuat agent: ${state.error}`));
  } else if (!state.agents.length) {
    list.append(el('p', { class: 'empty' }, 'Belum ada agent.'));
  }

  for (const g of groupAgents(state.agents)) {
    const open = !collapsedGroups.has(g.key);
    const summary = `${g.agents.length} agent${g.approvals ? `, ${g.approvals} butuh izin` : ''}`;
    // A native button toggles on Enter and Space by itself.
    const head = el('button', { type: 'button', class: 'group-head', 'aria-expanded': String(open), title: g.path ?? 'Agent contoh' },
      el('span', { class: 'chev', 'aria-hidden': 'true' }),
      el('span', { class: 'gname' }, g.name),
      el('span', { class: 'gsum', hidden: open ? '' : null }, summary),
    );
    head.addEventListener('click', () => {
      if (collapsedGroups.has(g.key)) collapsedGroups.delete(g.key);
      else collapsedGroups.add(g.key);
      renderSidebar(state, onSelect);
      list.querySelector(`.group-head[data-key="${CSS.escape(g.key)}"]`)?.focus();
    });
    head.dataset.key = g.key;
    const cards = el('div', { class: 'group-agents', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': g.name, hidden: open ? null : '' },
      ...g.agents.map((a) => agentCard(state, a, onSelect)));
    list.append(el('section', { class: 'group' }, head, cards));
  }

  const counts = {};
  for (const a of state.agents) counts[a.status] = (counts[a.status] || 0) + 1;
  const legend = document.getElementById('legend');
  legend.replaceChildren();
  for (const key of Object.keys(counts)) {
    const dot = el('span', { class: 'dot' });
    dot.style.setProperty('--c', STATUS[key].color);
    legend.append(el('span', {}, dot, `${STATUS[key].label} ${counts[key]}`));
  }

  document.getElementById('activeCount').textContent =
    state.agents.filter((a) => ACTIVE.includes(a.status)).length;
  renderRouter(state.router);
}

// Router health from the last /models call (sidebar line and status bar).
function renderRouter(r) {
  let side;
  let bar;
  let color;
  if (!r) {
    side = '9router: memeriksa...';
    bar = '\u2014';
    color = 'var(--st-idle)';
  } else if (!r.baseUrl || !r.hasKey) {
    side = !r.baseUrl ? '9router: isi URL dan kunci' : '9router: isi kunci';
    bar = 'belum diatur';
    color = 'var(--st-idle)';
  } else if (r.connected) {
    side = `9router terhubung, ${r.latencyMs} ms`;
    bar = `terhubung, ${r.latencyMs} ms`;
    color = 'var(--st-done)';
  } else {
    side = '9router terputus';
    bar = 'terputus';
    color = 'var(--st-error)';
  }
  document.getElementById('routerText').textContent = side;
  document.getElementById('routerState').textContent = bar;
  document.getElementById('routerDot').style.setProperty('--c', color);
  document.getElementById('routerBtn').title = r?.error ? `${r.error}. Klik untuk memeriksa lagi atau mengganti kunci.` : 'Kunci 9router dan status koneksi';
}

if (typeof module !== 'undefined') module.exports = { groupAgents };
