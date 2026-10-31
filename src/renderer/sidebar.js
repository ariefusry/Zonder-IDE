// Left column: agent cards. Also owns the office legend and status bar count,
// since all three are summaries of the same agent list.

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

  for (const a of state.agents) {
    const st = STATUS[a.status];
    const card = el('button', { class: 'agent', role: 'tab', 'aria-selected': String(a.id === state.selected) },
      el('span', { class: 'dot' }),
      el('span', { class: 'nm' }, a.name),
      el('span', { class: 'md' }, a.model),
      el('span', { class: 'stt' }, a.line ? `${st.label}: ${a.line}` : st.label),
    );
    card.style.setProperty('--c', st.color);
    card.addEventListener('click', () => onSelect(a.id));
    list.append(card);
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
}
