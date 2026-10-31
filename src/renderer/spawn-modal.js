// Spawn modal: name, role (fills an editable prompt), kind + model, workspace
// picked in the native dialog, base branch. Main validates everything again.

const spawnUi = { options: null, workspace: null, lastDefault: '', busy: false };

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
  for (const id of ['spName', 'spRole', 'spPrompt', 'spModel', 'spPick', 'spCancel', 'spSubmit']) spawnField(id).disabled = busy;
  spawnField('spBranch').disabled = busy || !spawnUi.workspace?.isRepo;
  spawnField('spSubmit').textContent = busy ? 'Membuat worktree...' : 'Spawn';
}

async function openSpawnModal() {
  const dialog = spawnField('spawnDialog');
  setSpawnError('');
  if (!spawnUi.options) {
    try {
      spawnUi.options = await window.zonder.spawnOptions();
    } catch (err) {
      setSpawnError(`Pilihan spawn gagal dimuat: ${err.message}`);
    }
  }
  const o = spawnUi.options;
  if (o) {
    const role = spawnField('spRole');
    if (!role.options.length) {
      fillSelect(role, o.roles.map((r) => r.role), 'Junior Developer');
      fillSelect(spawnField('spModel'), o.models, 'sonnet');
      spawnField('spKind').replaceChildren(el('option', { value: 'claude' }, 'Claude Code'));
    }
    if (!spawnField('spPrompt').value) applyRolePrompt();
  }
  renderWorkspace();
  dialog.showModal();
  spawnField('spName').focus();
}

// A role change replaces the prompt only while the owner has not edited it.
function applyRolePrompt() {
  const prompt = spawnField('spPrompt');
  const next = spawnUi.options.roles.find((r) => r.role === spawnField('spRole').value)?.prompt ?? '';
  if (prompt.value === spawnUi.lastDefault || !prompt.value) prompt.value = next;
  spawnUi.lastDefault = next;
}

function resetSpawnForm() {
  spawnField('spawnForm').reset();
  spawnUi.workspace = null;
  spawnUi.lastDefault = '';
  spawnField('spPrompt').value = '';
  setSpawnError('');
}

function initSpawnModal({ onSpawned }) {
  const dialog = spawnField('spawnDialog');
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
