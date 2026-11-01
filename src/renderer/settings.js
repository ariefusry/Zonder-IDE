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
