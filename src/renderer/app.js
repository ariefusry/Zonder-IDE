// Renderer entry: state, mock data, and event wiring. Loaded after
// sidebar.js and chat.js; the helpers below are used at call time.

const STATUS = {
  starting: { label: 'memulai', color: 'var(--st-idle)' },
  idle: { label: 'diam', color: 'var(--st-idle)' },
  thinking: { label: 'berpikir', color: 'var(--st-thinking)' },
  working: { label: 'bekerja', color: 'var(--st-working)' },
  testing: { label: 'menguji', color: 'var(--st-testing)' },
  approval: { label: 'menunggu izin', color: 'var(--st-approval)' },
  done: { label: 'selesai', color: 'var(--st-done)' },
  error: { label: 'error', color: 'var(--st-error)' },
  stopped: { label: 'berhenti', color: 'var(--st-idle)' },
};
const BUSY = ['thinking', 'working', 'testing'];
const ACTIVE = [...BUSY, 'approval'];

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

// Sample data for layout work only (?mock / ZONDER_MOCK=1). The toolbar says so on screen.
const MOCK_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'];
const MOCK_AGENTS = [
  { id: 'a1', name: 'Raka', role: 'Senior Developer', model: 'claude-sonnet-4-6', status: 'working', line: 'Menulis auth.test.ts' },
  { id: 'a2', name: 'Nadia', role: 'Junior Developer', model: 'claude-haiku-4-5', status: 'approval', line: 'npm install zod' },
  { id: 'a3', name: 'Bima', role: 'Reviewer', model: 'claude-opus-4-7', status: 'thinking', line: 'Membaca diff cabang' },
  { id: 'a4', name: 'Sari', role: 'QA Engineer', model: 'claude-haiku-4-5', status: 'idle', line: '' },
];
const MOCK_CHATS = {
  a1: [
    { t: 'agent', text: 'Saya mulai dari test suite untuk modul auth.' },
    { t: 'user', text: 'Tambahkan juga kasus token kedaluwarsa.', time: '14:33' },
    { t: 'agent', text: 'Siap. Menulis kasusnya:', code: "it('rejects expired token', async () => {\n  const token = sign({}, secret, { expiresIn: -1 });\n  await assert.rejects(verify(token));\n});" },
    { t: 'tool', tag: 'write', sum: 'src/auth/auth.test.ts', detail: 'Menulis 18 baris ke worktree agent.' },
    { t: 'tool', tag: 'bash', sum: 'npm run test:auth', detail: '$ npm run test:auth\nberjalan...' },
  ],
  a2: [
    { t: 'user', text: 'Tambahkan validasi input untuk form daftar.', time: '14:20' },
    { t: 'agent', text: 'Saya pakai zod untuk skema validasi. Paketnya belum terpasang.' },
    { t: 'approval', command: '$ npm install zod', why: 'Nadia (Junior Developer) ingin memasang paket. Pemasangan paket selalu bertanya.' },
  ],
  a3: [
    { t: 'user', text: 'Review perubahan di cabang zonder/raka.', time: '14:25' },
    { t: 'tool', tag: 'read', sum: 'git diff main...HEAD', detail: 'Hanya baca. Reviewer tidak punya akses tulis.' },
    { t: 'agent', text: 'Masih membaca perubahan. Belum ada temuan.' },
  ],
  a4: [],
};

const mock = new URLSearchParams(location.search).has('mock');
const state = { loading: true, error: null, agents: [], chats: {}, models: [], selected: null };

function render() {
  renderSidebar(state, select);
  renderChat(state, { onSelect: select, onApproval: resolveApproval });

  const note = document.getElementById('centerNote');
  note.replaceChildren();
  if (state.loading) {
    note.append('Memuat agent...');
  } else if (state.error) {
    note.append(el('h1', {}, 'Agent gagal dimuat'), state.error);
  } else if (!state.agents.length) {
    note.append(el('h1', {}, 'Apa yang ingin dikerjakan?'), 'Agent yang dibuat akan muncul di sini.');
  } else {
    // TODO(Task 10): the isometric office replaces this label.
    note.append('Kantor isometrik belum dibangun. Status agent ada di daftar kiri.');
  }
}

function select(id) {
  state.selected = id;
  render();
}

function now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Mock-only: real approvals go through window.zonder.respondApproval (Task 7).
function resolveApproval(agentId, index, decision) {
  const a = state.agents.find((x) => x.id === agentId);
  const item = state.chats[agentId][index];
  const cmd = item.command.replace(/^\$ /, '');
  const text = { once: `Diizinkan sekali: ${cmd}`, session: `Diizinkan untuk sesi ini: ${cmd}`, deny: 'Ditolak. Agent menerima alasan penolakan.' }[decision];
  state.chats[agentId][index] = { t: 'resolved', text };
  a.status = decision === 'deny' ? 'thinking' : 'working';
  a.line = decision === 'deny' ? 'Mencari cara tanpa paket baru' : `Menjalankan ${cmd}`;
  render();
}

document.getElementById('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('input');
  const text = input.value.trim();
  const a = state.agents.find((x) => x.id === state.selected);
  if (!text || !a) return;
  // TODO(Task 6): send through window.zonder.sendMessage for real agents.
  state.chats[a.id].push({ t: 'user', text, time: now(), queued: ACTIVE.includes(a.status) });
  input.value = '';
  render();
});

document.getElementById('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('composer').requestSubmit();
  }
});

document.getElementById('interrupt').addEventListener('click', () => {
  const a = state.agents.find((x) => x.id === state.selected);
  a.status = 'idle';
  a.line = 'Dihentikan';
  render();
});

document.getElementById('model').addEventListener('change', (e) => {
  const a = state.agents.find((x) => x.id === state.selected);
  a.model = e.target.value;
  render();
});

async function load() {
  render();
  try {
    if (mock) {
      state.agents = structuredClone(MOCK_AGENTS);
      state.chats = structuredClone(MOCK_CHATS);
      state.models = MOCK_MODELS;
      document.getElementById('sampleNote').hidden = false;
    } else {
      state.agents = await window.zonder.listAgents();
    }
    state.selected = state.agents[0]?.id ?? null;
  } catch (err) {
    state.error = err.message;
  }
  state.loading = false;
  render();
}

load();
