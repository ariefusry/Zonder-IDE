// Perubahan panel (layout spec §4.7–§4.8): what the selected agent changed in
// its worktree, read-only. Git runs in main; fileDiff only serves paths from
// the agent's last listChanges. Loading lives in app.js; this file renders.

const ChangeText = (() => {
  const TITLES = { M: 'Diubah', A: 'Baru', D: 'Dihapus' };

  function statusTitle(f) {
    return f.status === 'R' ? `Dipindah dari ${f.oldPath}` : TITLES[f.status];
  }

  // Unified diff -> [{kind, text}]. Inside a hunk a line is classed by its first
  // character only, so a removed "-- x" is not mistaken for a "--- a/" header.
  function diffLines(text) {
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    let inHunk = false;
    return lines.map((line) => {
      let kind = 'meta';
      if (line.startsWith('diff ')) inHunk = false;
      else if (line.startsWith('@@')) {
        inHunk = true;
        kind = 'hunk';
      } else if (inHunk) {
        kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : line[0] === ' ' || line === '' ? 'ctx' : 'meta';
      }
      return { kind, text: line };
    });
  }

  // The count stays hidden until the first listChanges has answered.
  function changesTabLabel(c) {
    return c?.files ? `Perubahan (${c.files.length})` : 'Perubahan';
  }

  return { statusTitle, diffLines, changesTabLabel };
})();

if (typeof module !== 'undefined') module.exports = ChangeText;

const WORKTREE_GONE = 'Worktree agent ini sudah tidak ada.';

function viewOf(state, agentId) {
  return state.view.get(agentId) ?? 'chat';
}

function changesOf(state, agentId) {
  if (!state.changes.has(agentId)) {
    state.changes.set(agentId, { loading: false, error: null, files: null, base: null, open: null, diff: null, seq: 0, diffSeq: 0, folderError: null });
  }
  return state.changes.get(agentId);
}

// Chat / Perubahan tabs under the chat head. Sample agents have no worktree.
function renderViewTabs(state, handlers) {
  const box = document.getElementById('viewTabs');
  const a = selectedAgent(state);
  const hadFocus = box.contains(document.activeElement);
  box.replaceChildren();
  box.hidden = !a || a.sample;
  if (box.hidden) return;
  const view = viewOf(state, a.id);
  const views = [['chat', 'Chat', 'msgs'], ['changes', ChangeText.changesTabLabel(state.changes.get(a.id)), 'changes']];
  for (const [v, label, panel] of views) {
    const tab = el('button', { type: 'button', class: 'vtab', role: 'tab', id: `view-${v}`, 'aria-selected': String(v === view), 'aria-controls': panel, tabindex: v === view ? '0' : '-1' }, label);
    tab.addEventListener('click', () => handlers.onView(a.id, v));
    tab.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 'chat' : e.key === 'End' ? 'changes' : v === 'chat' ? 'changes' : 'chat';
      handlers.onView(a.id, next);
      document.getElementById(`view-${next}`)?.focus();
    });
    box.append(tab);
  }
  if (hadFocus) document.getElementById(`view-${view}`).focus();
}

// The composer belongs to Chat only.
function applyView(state) {
  const a = selectedAgent(state);
  const changes = Boolean(a && !a.sample && viewOf(state, a.id) === 'changes');
  document.getElementById('msgs').hidden = changes;
  document.getElementById('composer').hidden = changes;
  document.getElementById('changes').hidden = !changes;
}

function renderChanges(state, handlers) {
  const box = document.getElementById('changes');
  const a = selectedAgent(state);
  if (!a || a.sample || viewOf(state, a.id) !== 'changes') return;
  const c = changesOf(state, a.id);
  // Buttons are rebuilt on every render; keep keyboard focus on the same one.
  const focused = document.activeElement?.dataset?.focus;
  const keep = box.contains(document.activeElement) ? focused : null;

  const button = (label, key, onClick) => {
    const b = el('button', { type: 'button', class: 'btn', 'data-focus': key }, label);
    b.addEventListener('click', onClick);
    return b;
  };
  const reload = button('Muat ulang', 'reload', () => handlers.onLoadChanges(a.id));
  reload.disabled = c.loading;
  const folder = button('Buka folder', 'folder', () => handlers.onOpenWorktree(a.id));
  const status = el('span', { class: 'ch-note', role: 'status' }, c.loading && c.files ? 'Membaca perubahan...' : c.folderError ? `Folder gagal dibuka: ${c.folderError}` : '');
  const bar = el('div', { class: 'ch-bar' }, reload, folder, status);

  const body = el('div', { class: 'ch-body' });
  const note = (text, cls = '') => el('p', { class: `ch-msg ${cls}` }, text);
  if (c.error) {
    body.append(note(c.error, c.error === WORKTREE_GONE ? '' : 'ch-err'));
    if (c.error !== WORKTREE_GONE) body.append(button('Coba lagi', 'retry', () => handlers.onLoadChanges(a.id)));
  } else if (!c.files) {
    body.append(note('Membaca perubahan...'));
  } else if (!c.files.length) {
    body.append(note('Belum ada perubahan dari agent ini.'));
  } else {
    const list = el('ul', { class: 'ch-list', 'aria-label': 'File yang berubah' });
    for (const f of c.files) {
      const letter = el('span', { class: `ch-st ch-${f.status}`, title: ChangeText.statusTitle(f) }, f.status);
      const row = el('button', { type: 'button', class: 'ch-file', 'data-focus': `file:${f.path}`, 'aria-pressed': String(c.open === f.path), 'aria-label': `${ChangeText.statusTitle(f)}: ${f.path}` }, letter, el('span', { class: 'ch-path' }, f.path));
      row.addEventListener('click', () => handlers.onOpenFile(a.id, f.path));
      list.append(el('li', {}, row));
    }
    body.append(list);
    if (c.open) body.append(renderDiff(c));
  }
  box.replaceChildren(bar, body);
  if (keep) box.querySelector(`[data-focus="${CSS.escape(keep)}"]`)?.focus();
}

function renderDiff(c) {
  const wrap = el('section', { class: 'ch-diff', 'aria-label': `Diff ${c.open}` }, el('h3', {}, c.open));
  const d = c.diff;
  if (!d || d.loading) wrap.append(el('p', { class: 'ch-msg' }, 'Membaca diff...'));
  else if (d.error) wrap.append(el('p', { class: 'ch-msg ch-err' }, d.error));
  else if (d.binary) wrap.append(el('p', { class: 'ch-msg' }, 'File biner, isinya tidak ditampilkan.'));
  else {
    if (d.truncated) wrap.append(el('p', { class: 'ch-msg' }, 'Diff dipotong di 200 KB.'));
    // One span per line; textContent only, so file contents never become markup.
    const pre = el('pre', {});
    for (const line of ChangeText.diffLines(d.text)) pre.append(el('span', { class: `dl dl-${line.kind}` }, `${line.text}\n`));
    wrap.append(pre);
  }
  return wrap;
}
