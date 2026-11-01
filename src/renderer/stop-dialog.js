// Stop dialog: keep the worktree, remove it, or remove it with its branch.
// Zonder never merges. A dirty worktree needs an explicit "discard" tick.

// The same dialog also handles orphan worktrees found at launch (no agent record).
const stopUi = { agentId: null, orphan: null, orphanQueue: [], dirty: false, busy: false };

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
  stopUi.orphan = null;
  stopField('stKeepLabel').textContent = 'Pertahankan worktree';
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

function openOrphanDialog(orphan) {
  stopUi.agentId = null;
  stopUi.orphan = orphan;
  stopUi.dirty = false;
  setStopError('');
  stopField('stTitle').textContent = 'Worktree tanpa agent';
  stopField('stLead').textContent = 'Worktree ini dibuat Zonder, tapi agent-nya sudah tidak tercatat. Pilih apa yang terjadi padanya. Zonder tidak pernah merge otomatis.';
  stopField('stInfo').textContent = `Branch ${orphan.branch ?? '(tanpa branch)'} · ${orphan.path}`;
  stopField('stKeepLabel').textContent = 'Biarkan untuk sekarang';
  stopField('stKeepRow').hidden = false;
  stopField('stopForm').reset();
  stopField('stKeep').checked = true;
  stopField('stopDialog').showModal();
  syncStopForm();
}

// Launch: offer each orphan worktree in turn.
async function checkOrphans() {
  try {
    stopUi.orphanQueue = await window.zonder.findOrphans();
  } catch {
    return; // Not fatal: the next launch checks again.
  }
  nextOrphan();
}

function nextOrphan() {
  const next = stopUi.orphanQueue.shift();
  if (next) openOrphanDialog(next);
}

function initStopDialog() {
  const dialog = stopField('stopDialog');
  stopField('stopForm').addEventListener('change', syncStopForm);
  stopField('stCancel').addEventListener('click', () => {
    dialog.close();
    if (stopUi.orphan) nextOrphan();
  });
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
      if (!stopUi.orphan) await window.zonder.stopAgent(stopUi.agentId, stopChoice(), stopField('stDiscard').checked);
      else if (stopChoice() !== 'keep') await window.zonder.cleanupOrphan(stopUi.orphan.path, stopChoice(), stopField('stDiscard').checked);
      dialog.close();
      if (stopUi.orphan) nextOrphan();
    } catch (err) {
      // An orphan's dirty state is only known when removal is refused.
      if (stopUi.orphan && /belum di-commit/.test(err.message)) stopUi.dirty = true;
      setStopError(ipcMessage(err));
    }
    stopUi.busy = false;
    stopField('stConfirm').textContent = 'Lanjutkan';
    syncStopForm();
  });
}
