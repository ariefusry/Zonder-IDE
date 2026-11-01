// Desktop alerts (settings spec §4.7) when an agent needs the owner, finishes,
// or fails. Only while the window is not focused: what is on screen needs no
// ping. The body names the agent and its kind, never chat text.

const LABELS = { approval: 'butuh izin', done: 'selesai', error: 'mengalami error' };
const KIND = { claude: 'Claude', router: '9router' };

function startNotifier({ store, getWindow, settings, Notification }) {
  return store.subscribe((e) => {
    if (e.type !== 'status' || !LABELS[e.to]) return;
    if (!settings.get().notify[e.to]) return;
    if (getWindow()?.isFocused?.()) return;
    const rec = store.get(e.agentId);
    if (!rec || rec.sample) return;
    new Notification({ title: `Zonder: ${rec.name} ${LABELS[e.to]}`, body: `Agent ${KIND[rec.kind] ?? rec.kind} ${rec.name}` }).show();
  });
}

module.exports = { startNotifier };
