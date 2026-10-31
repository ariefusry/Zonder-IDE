// Stop dialog: keep the worktree, remove it, or remove it with its branch.
// Zonder never merges. A dirty worktree needs an explicit "discard" tick.

const stopUi = { agentId: null, dirty: false, busy: false };

function stopField(id) {
  return document.getElementById(id);
}

const ipcMessage = (err) => err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function setStopError(text) {
  stopField('stError').textContent = text || '';
  stopField('stError').hidden = !text;
}

function stopChoice() {
  return stopField('stopForm').elements.cleanup.value;
}

function syncStopForm() {
  const removing = stopChoice() !== 'keep';
  stopField('stDirty').hidden = !(removing && stopUi.dirty);
  const blocked = removing && stopUi.dirty && !stopField('stDiscard').checked;
  stopField('stConfirm').disabled = stopUi.busy || blocked;
}

async function openStopDialog(agent) {
  stopUi.agentId = agent.id;
  stopUi.dirty = false;
  setStopError('');
  const running = agent.status !== 'stopped';
  stopField('stTitle').textContent = running ? `Hentikan ${agent.name}` : `Bersihkan ${agent.name}`;
  stopField('stLead').textContent = running
    ? 'Proses agent dihentikan. Pilih apa yang terjadi pada worktree-nya. Zonder tidak pernah merge otomatis.'
    : 'Agent sudah berhenti. Pilih apa yang terjadi pada worktree-nya. Zonder tidak pernah merge otomatis.';
  stopField('stKeepRow').hidden = !running;
  stopField('stopForm').reset();
  stopField(running ? 'stKeep' : 'stWorktree').checked = true;
  stopField('stInfo').textContent = 'Memeriksa worktree...';
  stopField('stopDialog').showModal();
  syncStopForm();
  try {
    const st = await window.zonder.worktreeStatus(agent.id);
    stopUi.dirty = st.dirty;
    stopField('stInfo').textContent = `Branch ${st.branch} · ${st.path}`;
  } catch (err) {
    stopField('stInfo').textContent = `Status worktree tidak terbaca: ${ipcMessage(err)}`;
  }
  syncStopForm();
}

function initStopDialog() {
  const dialog = stopField('stopDialog');
  stopField('stopForm').addEventListener('change', syncStopForm);
  stopField('stCancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (e) => {
    if (stopUi.busy) e.preventDefault();
  });
  stopField('stopForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (stopUi.busy) return;
    stopUi.busy = true;
    stopField('stConfirm').textContent = 'Menghentikan...';
    syncStopForm();
    setStopError('');
    try {
      await window.zonder.stopAgent(stopUi.agentId, stopChoice(), stopField('stDiscard').checked);
      dialog.close();
    } catch (err) {
      setStopError(ipcMessage(err));
    }
    stopUi.busy = false;
    stopField('stConfirm').textContent = 'Lanjutkan';
    syncStopForm();
  });
}
