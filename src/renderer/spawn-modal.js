// Spawn modal: name, role (fills an editable prompt), kind + model, workspace
// picked in the native dialog, base branch. Main validates everything again.

const spawnUi = { options: null, workspace: null, lastDefault: '', busy: false, onRouter: null };
const KIND_LABELS = { claude: 'Claude Code', router: '9router' };
const PROMPT_HINTS = {
  claude: 'Ditambahkan ke prompt bawaan Claude Code. Aturan izin peran tetap ditegakkan Zonder, apa pun isi prompt ini.',
  router: 'Ditambahkan ke prompt dasar Zonder untuk agent 9router. Aturan izin peran tetap ditegakkan Zonder, apa pun isi prompt ini.',
};

function spawnField(id) {
  return document.getElementById(id);
}

function setSpawnError(text) {
  const box = spawnField('spError');
  box.textContent = text || '';
  box.hidden = !text;
}

function fillSelect(select, values, selected) {
  select.replaceChildren(...values.map((v) => el('option', { value: v, selected: v === selected ? '' : null }, v)));
}

function renderWorkspace() {
  const ws = spawnUi.workspace;
  const pathEl = spawnField('spPath');
  const branch = spawnField('spBranch');
  pathEl.textContent = ws ? ws.path : 'Belum dipilih';
  pathEl.classList.toggle('muted', !ws);
  if (ws?.isRepo) {
    fillSelect(branch, ws.branches, ws.current && ws.branches.includes(ws.current) ? ws.current : ws.branches[0]);
    branch.disabled = false;
  } else {
    branch.replaceChildren(el('option', {}, 'Pilih workspace dulu'));
    branch.disabled = true;
  }
}

function setSpawnBusy(busy) {
  spawnUi.busy = busy;
  for (const id of ['spName', 'spRole', 'spPrompt', 'spKind', 'spModel', 'spPick', 'spCancel', 'spSubmit']) spawnField(id).disabled = busy;
  spawnField('spBranch').disabled = busy || !spawnUi.workspace?.isRepo;
  spawnField('spSubmit').textContent = busy ? 'Membuat worktree...' : 'Spawn';
}

async function openSpawnModal() {
  const dialog = spawnField('spawnDialog');
  setSpawnError('');
  // Roles change in Settings, so the options are fetched again on every open.
  try {
    spawnUi.options = await window.zonder.spawnOptions();
  } catch (err) {
    setSpawnError(`Pilihan spawn gagal dimuat: ${err.message}`);
  }
  const o = spawnUi.options;
  if (o) {
    const role = spawnField('spRole');
    const names = o.roles.map((r) => r.role);
    const keep = names.includes(role.value) ? role.value : 'Junior Developer';
    if (!spawnField('spKind').options.length) {
      spawnField('spKind').replaceChildren(...o.kinds.map((k) => el('option', { value: k }, KIND_LABELS[k] ?? k)));
      fillSelect(spawnField('spModel'), o.models, 'sonnet');
    }
    fillSelect(role, names, keep);
    // form.reset() puts the kind back to its first option; the model list must follow.
    applyKind();
    applyRolePrompt();
  }
  if (!spawnUi.workspace) await prefillWorkspace();
  renderWorkspace();
  dialog.showModal();
  spawnField('spName').focus();
}

// The default repo and base branch from Settings (§4.5). A repo that is gone
// or unreadable leaves the field empty, as before Settings existed.
async function prefillWorkspace() {
  try {
    const { workspace } = await window.zonder.getSettings();
    if (!workspace.defaultRepo) return;
    const branches = await window.zonder.listBranches(workspace.defaultRepo);
    if (!branches.length) return;
    spawnUi.workspace = { path: workspace.defaultRepo, isRepo: true, branches, current: workspace.baseBranch };
  } catch {
    spawnUi.workspace = null;
  }
}

// A role change replaces the prompt only while the owner has not edited it.
function applyRolePrompt() {
  const prompt = spawnField('spPrompt');
  const next = spawnUi.options.roles.find((r) => r.role === spawnField('spRole').value)?.prompt ?? '';
  if (prompt.value === spawnUi.lastDefault || !prompt.value) prompt.value = next;
  spawnUi.lastDefault = next;
}

// Router models come from the router itself, so they are fetched on demand.
async function applyKind() {
  const kind = spawnField('spKind').value;
  const model = spawnField('spModel');
  spawnField('spPromptHint').textContent = PROMPT_HINTS[kind];
  setSpawnError('');
  if (kind !== 'router') {
    fillSelect(model, spawnUi.options.models, 'sonnet');
    return;
  }
  model.replaceChildren(el('option', {}, 'Memuat model...'));
  model.disabled = true;
  let r;
  try {
    r = await window.zonder.listModels();
  } catch (err) {
    r = { baseUrl: state.router?.baseUrl ?? null, hasKey: state.router?.hasKey ?? false, connected: false, latencyMs: null, models: [], error: err.message };
  }
  spawnUi.onRouter?.(r);
  if (spawnField('spKind').value !== 'router') return;
  model.disabled = spawnUi.busy;
  if (r.connected && r.models.length) {
    fillSelect(model, r.models, r.models[0]);
    return;
  }
  model.replaceChildren(el('option', {}, 'Tidak ada model'));
  setSpawnError(!r.baseUrl || !r.hasKey ? 'URL atau kunci 9router belum diisi. Klik 9router di sidebar untuk mengisinya.' : r.connected ? 'Router tidak mengembalikan model.' : `9router tidak bisa dihubungi: ${r.error}`);
}

function resetSpawnForm() {
  spawnField('spawnForm').reset();
  spawnUi.workspace = null;
  spawnUi.lastDefault = '';
  spawnField('spPrompt').value = '';
  setSpawnError('');
}

function initSpawnModal({ onSpawned, onRouter }) {
  const dialog = spawnField('spawnDialog');
  spawnUi.onRouter = onRouter;
  spawnField('spKind').addEventListener('change', applyKind);
  spawnField('spawn').addEventListener('click', openSpawnModal);
  spawnField('spRole').addEventListener('change', applyRolePrompt);
  spawnField('spCancel').addEventListener('click', () => dialog.close());
  // Esc must not close the modal halfway through a spawn.
  dialog.addEventListener('cancel', (e) => {
    if (spawnUi.busy) e.preventDefault();
  });

  spawnField('spPick').addEventListener('click', async () => {
    setSpawnError('');
    try {
      const ws = await window.zonder.selectWorkspace();
      if (!ws) return;
      if (!ws.isRepo) {
        setSpawnError(`${ws.path} bukan root repo Git. Pilih folder teratas repo (yang berisi folder .git).`);
        spawnUi.workspace = null;
      } else if (!ws.branches.length) {
        setSpawnError('Repo ini belum punya branch. Buat commit pertama dulu.');
        spawnUi.workspace = null;
      } else {
        spawnUi.workspace = ws;
      }
      renderWorkspace();
    } catch (err) {
      setSpawnError(`Folder gagal dibaca: ${err.message}`);
    }
  });

  spawnField('spawnForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (spawnUi.busy) return;
    const name = spawnField('spName').value.trim();
    if (!name) {
      setSpawnError('Isi nama agent.');
      spawnField('spName').focus();
      return;
    }
    if (!spawnUi.workspace) {
      setSpawnError('Pilih workspace dulu.');
      spawnField('spPick').focus();
      return;
    }
    setSpawnError('');
    setSpawnBusy(true);
    try {
      const record = await window.zonder.spawnAgent({
        name,
        role: spawnField('spRole').value,
        systemPrompt: spawnField('spPrompt').value,
        kind: spawnField('spKind').value,
        model: spawnField('spModel').value,
        workspace: spawnUi.workspace.path,
        baseBranch: spawnField('spBranch').value,
      });
      setSpawnBusy(false);
      dialog.close();
      resetSpawnForm();
      onSpawned(record);
    } catch (err) {
      setSpawnBusy(false);
      // ipcRenderer.invoke prefixes the message with the channel; keep only ours.
      setSpawnError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  });
}
