// Settings page (settings spec §3), opened from the header gear or the sidebar
// router button. It takes the place of the main view while open; agents keep
// running behind it. Uses app.js globals (state, setRouter, refreshRouter) at
// call time, so it can load before app.js.

const SETTINGS_SECTIONS = ['providers', 'roles', 'skills', 'agent', 'workspace', 'notify'];
const settingsUi = { section: null, opener: null, claude: null, claudeBusy: false };

function routerStateText(r) {
  if (!r) return 'Memeriksa router...';
  if (!r.baseUrl && !r.hasKey) return 'Belum ada URL dan kunci tersimpan.';
  if (!r.baseUrl) return 'Kunci tersimpan, URL belum diisi.';
  if (!r.hasKey) return 'URL tersimpan, kunci belum diisi.';
  if (r.connected) return `Router terhubung (${r.latencyMs} ms), ${r.models.length} model.`;
  return `Router tidak bisa dipakai: ${r.error}`;
}

function routerColor(r) {
  if (!r || !r.baseUrl || !r.hasKey) return 'var(--st-idle)';
  return r.connected ? 'var(--st-done)' : 'var(--st-error)';
}

const setField = (id) => document.getElementById(id);

function showRouterError(text) {
  const box = setField('rkError');
  box.textContent = text || '';
  box.hidden = !text;
}

// The URL is not secret, so it is prefilled; the key never comes back.
function fillRouterCard() {
  const r = state.router;
  setField('rkState').textContent = routerStateText(r);
  setField('rkDot').style.setProperty('--c', routerColor(r));
  const url = setField('rkUrl');
  if (!url.value) url.value = r?.baseUrl ?? '';
  setField('rkKeyHint').textContent = r?.hasKey
    ? 'Kunci sudah tersimpan terenkripsi. Kosongkan untuk tetap memakainya, atau isi untuk mengganti.'
    : 'Disimpan terenkripsi oleh Windows (safeStorage). Zonder tidak menampilkannya lagi.';
}

function fillClaudeCard() {
  const c = settingsUi.claude;
  let text = 'Memeriksa...';
  let color = 'var(--st-idle)';
  let login = '';
  if (c && !c.installed) {
    text = c.error;
    color = 'var(--st-error)';
    login = 'Pasang Claude Code, lalu klik Periksa ulang.';
  } else if (c) {
    text = 'Terpasang';
    color = c.loggedIn === false ? 'var(--st-approval)' : 'var(--st-done)';
    login = c.loggedIn === true ? 'Sudah login.'
      : c.loggedIn === false ? 'Belum login. Jalankan claude di terminal, lalu login.'
        : 'Status login tidak terbaca.';
  }
  setField('ccState').textContent = text;
  setField('ccDot').style.setProperty('--c', color);
  setField('ccVersion').textContent = c?.version ? `v${c.version}` : '';
  setField('ccLogin').textContent = login;
  const btn = setField('ccCheck');
  btn.disabled = settingsUi.claudeBusy;
  btn.textContent = settingsUi.claudeBusy ? 'Memeriksa...' : 'Periksa ulang';
}

async function checkClaudeStatus() {
  if (settingsUi.claudeBusy) return;
  settingsUi.claudeBusy = true;
  fillClaudeCard();
  try {
    settingsUi.claude = await window.zonder.claudeStatus();
  } catch (err) {
    settingsUi.claude = { installed: false, version: null, loggedIn: null, error: `Pemeriksaan gagal: ${ipcMessage(err)}` };
  }
  settingsUi.claudeBusy = false;
  fillClaudeCard();
}

function showSettingsSection(section) {
  settingsUi.section = section;
  for (const name of SETTINGS_SECTIONS) setField(`set-${name}`).hidden = name !== section;
  for (const btn of document.querySelectorAll('#setNav button')) {
    if (btn.dataset.section === section) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  if (section === 'roles') {
    loadRoles();
    loadSkills();
  }
  if (section === 'skills') loadSkills();
  if (['workspace', 'agent', 'notify'].includes(section)) {
    for (const id of ['wsSaved', 'agSaved', 'ntSaved']) setField(id).textContent = '';
    loadPrefs();
  }
  if (section === 'providers') {
    showRouterError('');
    setField('rkUrl').value = '';
    fillRouterCard();
    refreshRouter().then(fillRouterCard);
    if (!settingsUi.claude) checkClaudeStatus();
  }
}

function openSettings(section = 'providers') {
  if (!SETTINGS_SECTIONS.includes(section)) section = 'providers';
  const page = setField('settings');
  if (page.hidden) settingsUi.opener = document.activeElement;
  document.querySelector('.main').hidden = true;
  page.hidden = false;
  showSettingsSection(section);
  document.querySelector(`#setNav button[data-section="${section}"]`).focus();
}

function closeSettings() {
  const page = setField('settings');
  if (page.hidden) return;
  // The key lives in the input only until it is sent; it is never kept in state.
  setField('rkKey').value = '';
  page.hidden = true;
  document.querySelector('.main').hidden = false;
  const back = settingsUi.opener;
  (back?.isConnected && back !== document.body ? back : setField('settingsBtn')).focus();
  settingsUi.opener = null;
}

function initSettings() {
  setField('settingsBtn').addEventListener('click', () => openSettings());
  setField('routerBtn').addEventListener('click', () => openSettings('providers'));
  setField('setBack').addEventListener('click', closeSettings);
  setField('setNav').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-section]');
    if (btn) showSettingsSection(btn.dataset.section);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !setField('settings').hidden && !document.querySelector('dialog[open]')) closeSettings();
  });
  setField('ccCheck').addEventListener('click', checkClaudeStatus);
  initRolesPane();
  initPrefsPanes();
  setField('roleSkillFilter').addEventListener('input', renderRoleSkills);
  setField('roleSkillChecks').addEventListener('change', (e) => {
    const box = e.target.closest('input[type=checkbox]');
    if (!box) return;
    if (box.checked) rolesUi.skills.add(box.value);
    else rolesUi.skills.delete(box.value);
    renderRoleSkillCount();
  });

  const url = setField('rkUrl');
  const input = setField('rkKey');
  const save = setField('rkSave');
  setField('keyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!url.value.trim()) {
      showRouterError('Isi URL endpoint 9router.');
      url.focus();
      return;
    }
    if (!input.value.trim() && !state.router?.hasKey) {
      showRouterError('Isi API key.');
      input.focus();
      return;
    }
    showRouterError('');
    save.disabled = true;
    save.textContent = 'Memeriksa...';
    const key = input.value;
    input.value = '';
    try {
      const r = await window.zonder.setRouterKey({ baseUrl: url.value.trim(), key });
      setRouter(r);
      fillRouterCard();
      if (!r.connected) showRouterError(`Disimpan, tapi router belum bisa dipakai: ${r.error}`);
    } catch (err) {
      showRouterError(ipcMessage(err));
    }
    save.disabled = false;
    save.textContent = 'Simpan dan periksa';
  });
}

// Roles pane (settings spec §4.3). Main validates and stores; this pane only
// edits one role at a time. A new role exists only once it is saved.
const rolesUi = { skills: new Set(), list: null, error: null, loading: false, current: null, isNew: false, dirty: false, pendingSwitch: null, confirm: null, busy: false };

function setRoleNames(list) {
  state.roleNames = new Set(list.map((r) => r.name));
  renderChrome();
}

async function loadRoles(selectName) {
  rolesUi.loading = true;
  rolesUi.error = null;
  renderRoleList();
  try {
    rolesUi.list = await window.zonder.listRoles();
    setRoleNames(rolesUi.list);
  } catch (err) {
    rolesUi.error = ipcMessage(err);
  }
  rolesUi.loading = false;
  const keep = selectName ?? (rolesUi.isNew ? null : rolesUi.current?.name);
  const next = rolesUi.list?.find((r) => r.name === keep) ?? (rolesUi.isNew ? null : rolesUi.list?.[0]);
  if (next) editRole(next);
  else if (!rolesUi.isNew) setField('roleForm').hidden = true;
  renderRoleList();
}

function renderRoleList() {
  const box = setField('roleList');
  box.replaceChildren();
  if (rolesUi.loading && !rolesUi.list) {
    box.append(el('p', { class: 'hint' }, 'Memuat peran...'));
    return;
  }
  if (rolesUi.error) {
    const retry = el('button', { type: 'button', class: 'btn' }, 'Coba lagi');
    retry.addEventListener('click', () => loadRoles());
    box.append(el('p', { class: 'form-error' }, `Peran gagal dimuat: ${rolesUi.error}`), retry);
    return;
  }
  for (const r of rolesUi.list ?? []) {
    const current = !rolesUi.isNew && rolesUi.current?.name === r.name;
    const item = el('button', { type: 'button', class: 'role-item', 'aria-current': current ? 'true' : null },
      el('span', { class: 'nm' }, r.name),
      ...(r.builtin ? [el('span', { class: 'tag' }, 'bawaan')] : []));
    item.addEventListener('click', () => switchRole(r));
    box.append(item);
  }
  if (rolesUi.isNew) box.append(el('div', { class: 'role-item', 'aria-current': 'true' }, el('span', { class: 'nm' }, 'Peran baru')));
}

function showRoleError(text) {
  const box = setField('roleError');
  box.textContent = text || '';
  box.hidden = !text;
}

function showRoleConfirm(confirm) {
  rolesUi.confirm = confirm;
  setField('roleConfirm').hidden = !confirm;
  if (confirm) {
    setField('roleConfirmText').textContent = confirm.text;
    setField('roleConfirmYes').textContent = confirm.yes;
    setField('roleConfirmYes').focus();
  }
}

// Switching away from unsaved edits asks once, inline.
function switchRole(role) {
  if (rolesUi.busy) return;
  if (rolesUi.dirty) {
    showRoleConfirm({ text: 'Perubahan belum disimpan.', yes: 'Buang perubahan', run: () => (role ? editRole(role) : newRole()) });
    return;
  }
  if (role) editRole(role);
  else newRole();
}

function fillRoleForm(role) {
  const builtin = Boolean(role.builtin);
  setField('roleForm').hidden = false;
  setField('roleTitle').textContent = rolesUi.isNew ? 'Peran baru' : role.name;
  setField('roleName').value = role.name;
  setField('roleName').readOnly = builtin;
  setField('roleNameHint').textContent = builtin ? 'Nama peran bawaan tidak bisa diubah.' : 'Paling banyak 40 karakter.';
  setField('rolePersona').value = role.persona;
  setField('roleWrite').value = role.write;
  setField('roleShell').value = role.shell;
  rolesUi.skills = new Set(role.skills ?? []);
  setField('roleNoSkills').checked = Boolean(role.disableSkills);
  setField('roleSkillFilter').value = '';
  renderRoleSkills();
  setField('roleDelete').hidden = builtin || rolesUi.isNew;
  setField('roleReset').hidden = !builtin;
  showRoleError('');
  showRoleConfirm(null);
  rolesUi.dirty = false;
  renderRoleList();
}

function editRole(role) {
  rolesUi.isNew = false;
  rolesUi.current = role;
  fillRoleForm(role);
}

function newRole() {
  rolesUi.isNew = true;
  rolesUi.current = { name: '', builtin: false, persona: '', write: 'ask', shell: 'ask', skills: [], disableSkills: false };
  fillRoleForm(rolesUi.current);
  setField('roleName').focus();
}

function setRoleBusy(busy, label) {
  rolesUi.busy = busy;
  for (const id of ['roleSave', 'roleDelete', 'roleReset', 'roleAdd', 'roleConfirmYes', 'roleConfirmNo']) setField(id).disabled = busy;
  setField('roleSave').textContent = busy && label ? label : 'Simpan';
}

async function roleAction(label, fn) {
  setRoleBusy(true, label);
  showRoleError('');
  try {
    const name = await fn();
    rolesUi.isNew = false;
    rolesUi.dirty = false;
    await loadRoles(name);
  } catch (err) {
    showRoleError(ipcMessage(err));
  }
  setRoleBusy(false);
}

function initRolesPane() {
  const form = setField('roleForm');
  // Typing in the skill filter is not an edit.
  form.addEventListener('input', (e) => { if (e.target.id !== 'roleSkillFilter') rolesUi.dirty = true; });
  setField('roleAdd').addEventListener('click', () => switchRole(null));
  setField('roleConfirmNo').addEventListener('click', () => showRoleConfirm(null));
  setField('roleConfirmYes').addEventListener('click', () => {
    const c = rolesUi.confirm;
    showRoleConfirm(null);
    rolesUi.dirty = false;
    c?.run();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (rolesUi.busy) return;
    const cur = rolesUi.current;
    const name = setField('roleName').value.trim();
    if (!name) {
      showRoleError('Isi nama peran.');
      setField('roleName').focus();
      return;
    }
    const role = {
      name,
      persona: setField('rolePersona').value,
      write: setField('roleWrite').value,
      shell: setField('roleShell').value,
      skills: [...rolesUi.skills],
      disableSkills: setField('roleNoSkills').checked,
    };
    // Renaming a custom role saves it under the new name, then removes the old one.
    const renamed = !rolesUi.isNew && !cur.builtin && name !== cur.name;
    roleAction('Menyimpan...', async () => {
      const saved = await window.zonder.saveRole({ ...role, isNew: rolesUi.isNew || renamed });
      if (renamed) await window.zonder.deleteRole(cur.name);
      return saved.name;
    });
  });

  setField('roleDelete').addEventListener('click', () => {
    const cur = rolesUi.current;
    showRoleConfirm({
      text: `Hapus peran "${cur.name}"? Agent yang sedang memakainya tetap memakai aturan saat ia dibuat.`,
      yes: 'Hapus',
      run: () => roleAction('Menghapus...', async () => {
        await window.zonder.deleteRole(cur.name);
        rolesUi.current = null;
        return null;
      }),
    });
  });

  setField('roleReset').addEventListener('click', () => {
    const cur = rolesUi.current;
    showRoleConfirm({
      text: `Kembalikan persona dan izin "${cur.name}" ke default?`,
      yes: 'Kembalikan',
      run: () => roleAction('Mengembalikan...', async () => (await window.zonder.resetRole(cur.name)).name),
    });
  });
}

// Skills (settings spec §4.4): the list comes from main without folder paths.
const skillsUi = { list: null, error: null, loading: false };

async function loadSkills() {
  if (skillsUi.loading) return;
  skillsUi.loading = true;
  skillsUi.error = null;
  renderSkillsPane();
  try {
    skillsUi.list = await window.zonder.listSkills();
  } catch (err) {
    skillsUi.error = ipcMessage(err);
  }
  skillsUi.loading = false;
  renderSkillsPane();
  renderRoleSkills();
}

// The empty, loading and error lines both panes share; null when the list is ready.
function skillsStatus(retry) {
  if (skillsUi.error) {
    const btn = el('button', { type: 'button', class: 'btn' }, 'Coba lagi');
    btn.addEventListener('click', retry);
    return [el('p', { class: 'form-error' }, `Skill gagal dibaca: ${skillsUi.error}`), btn];
  }
  if (!skillsUi.list) return [el('p', { class: 'hint' }, 'Membaca skill...')];
  if (!skillsUi.list.length) return [el('p', { class: 'hint' }, 'Belum ada skill. Pasang skill di ~/.claude/skills atau lewat plugin Claude Code.')];
  return null;
}

function bySource(list) {
  const groups = new Map();
  for (const s of list) {
    if (!groups.has(s.source)) groups.set(s.source, []);
    groups.get(s.source).push(s);
  }
  return groups;
}

const sourceLabel = (source) => (source === 'user' ? 'Skill pribadi' : `Plugin ${source}`);

function renderSkillsPane() {
  const box = setField('skillList');
  const status = skillsStatus(loadSkills);
  if (status) {
    box.replaceChildren(...status);
    return;
  }
  box.replaceChildren(el('p', { class: 'hint' }, `${skillsUi.list.length} skill ditemukan.`));
  for (const [source, items] of bySource(skillsUi.list)) {
    box.append(el('h2', { class: 'set-label' }, `${sourceLabel(source)} (${items.length})`),
      el('div', { class: 'set-card skill-card' }, ...items.map((s) => el('div', { class: 'skill-row' },
        el('b', {}, s.name),
        el('span', { class: 'hint' }, s.description || 'Tanpa deskripsi.')))));
  }
}

function renderRoleSkillCount() {
  const n = rolesUi.skills.size;
  setField('roleSkillCount').textContent = n ? `${n} dipilih` : 'belum ada yang dipilih';
}

function renderRoleSkills() {
  const box = setField('roleSkillChecks');
  renderRoleSkillCount();
  const status = skillsStatus(loadSkills);
  if (status) {
    box.replaceChildren(...status);
    return;
  }
  const q = setField('roleSkillFilter').value.trim().toLowerCase();
  const shown = skillsUi.list.filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.source.toLowerCase().includes(q));
  box.replaceChildren();
  if (!shown.length) box.append(el('p', { class: 'hint' }, 'Tidak ada skill yang cocok.'));
  for (const [source, items] of bySource(shown)) {
    box.append(el('div', { class: 'skill-group' }, sourceLabel(source)));
    for (const s of items) {
      box.append(el('label', { class: 'skill-check' },
        el('input', { type: 'checkbox', value: s.id, checked: rolesUi.skills.has(s.id) ? '' : null }),
        el('span', {}, el('b', {}, s.name), el('small', {}, s.description || 'Tanpa deskripsi.'))));
    }
  }
}

// Workspace, Agent and Notifikasi (settings spec §4.5–§4.7). Main validates
// every value again; the forms only show its message.
const prefsUi = { settings: null, busy: false };

async function loadPrefs() {
  try {
    prefsUi.settings = await window.zonder.getSettings();
  } catch (err) {
    for (const id of ['wsError', 'agError', 'ntError2']) showPrefsMessage(id, `Pengaturan gagal dibaca: ${ipcMessage(err)}`);
    return;
  }
  fillPrefs();
}

function showPrefsMessage(id, text) {
  setField(id).textContent = text || '';
  setField(id).hidden = !text;
}

async function fillBranches(repo) {
  const list = setField('wsBranches');
  list.replaceChildren();
  if (!repo) return;
  try {
    for (const b of await window.zonder.listBranches(repo)) list.append(el('option', { value: b }));
  } catch {
    // The repo may be gone; the field still takes a typed name.
  }
}

function fillPrefs() {
  const { workspace, agent, notify } = prefsUi.settings;
  const repo = setField('wsRepo');
  repo.textContent = workspace.defaultRepo ?? 'Belum dipilih';
  repo.classList.toggle('muted', !workspace.defaultRepo);
  setField('wsClear').disabled = !workspace.defaultRepo;
  setField('wsBranch').value = workspace.baseBranch;
  const stop = setField('wsForm').elements.wsStop;
  stop.value = workspace.stopCleanup ?? '';
  fillBranches(workspace.defaultRepo);
  setField('agRounds').value = agent.maxToolRounds;
  setField('agTimeout').value = agent.commandTimeoutSec;
  setField('ntApproval').checked = notify.approval;
  setField('ntDone').checked = notify.done;
  setField('ntError').checked = notify.error;
}

// Saves one pane's patch; the status line says what happened.
async function savePrefs(patch, { error, saved, button }) {
  if (prefsUi.busy) return;
  prefsUi.busy = true;
  setField(button).disabled = true;
  showPrefsMessage(error, '');
  setField(saved).textContent = '';
  try {
    prefsUi.settings = await window.zonder.updateSettings(patch);
    fillPrefs();
    setField(saved).textContent = 'Tersimpan.';
  } catch (err) {
    showPrefsMessage(error, ipcMessage(err));
  }
  prefsUi.busy = false;
  setField(button).disabled = false;
}

// A number field read as an integer; anything else goes to main as-is and is refused there.
const intField = (id) => {
  const v = setField(id).value.trim();
  return /^\d+$/.test(v) ? Number(v) : v;
};

function initPrefsPanes() {
  setField('wsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const stop = setField('wsForm').elements.wsStop.value;
    savePrefs({ workspace: { baseBranch: setField('wsBranch').value, stopCleanup: stop || null } }, { error: 'wsError', saved: 'wsSaved', button: 'wsSave' });
  });
  setField('wsPick').addEventListener('click', async () => {
    showPrefsMessage('wsError', '');
    try {
      if (!(await window.zonder.pickDefaultRepo())) return;
      prefsUi.settings = await window.zonder.getSettings();
      fillPrefs();
      setField('wsSaved').textContent = 'Repo bawaan tersimpan.';
    } catch (err) {
      showPrefsMessage('wsError', ipcMessage(err));
    }
  });
  setField('wsClear').addEventListener('click', () => {
    savePrefs({ workspace: { defaultRepo: null } }, { error: 'wsError', saved: 'wsSaved', button: 'wsClear' });
  });
  setField('agentForm').addEventListener('submit', (e) => {
    e.preventDefault();
    savePrefs({ agent: { maxToolRounds: intField('agRounds'), commandTimeoutSec: intField('agTimeout') } }, { error: 'agError', saved: 'agSaved', button: 'agSave' });
  });
  setField('ntForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const notify = { approval: setField('ntApproval').checked, done: setField('ntDone').checked, error: setField('ntError').checked };
    savePrefs({ notify }, { error: 'ntError2', saved: 'ntSaved', button: 'ntSave' });
  });
}
