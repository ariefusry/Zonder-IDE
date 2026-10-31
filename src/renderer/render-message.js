// Agent events -> chat view models. Pure: no DOM, so it runs under node:test
// and in the sandboxed renderer (plain <script>, exports via a global there).

const CHOICES = [
  { decision: 'once', label: 'Izinkan sekali' },
  { decision: 'session', label: 'Izinkan untuk sesi ini' },
  { decision: 'deny', label: 'Tolak' },
];
const TURN_OVER = ['idle', 'done', 'error', 'stopped'];

// Fenced code (```lang ... ```) becomes code parts; everything stays plain text.
// An unclosed fence counts as code, so a streaming block renders as it grows.
function splitFences(text) {
  const parts = [];
  const lines = String(text).split('\n');
  let buf = [];
  let code = null;
  const flush = (type, lang) => {
    const t = buf.join('\n');
    buf = [];
    if (type === 'code') parts.push({ type, lang, text: t });
    else if (t.trim()) parts.push({ type, text: t.replace(/^\n+|\n+$/g, '') });
  };
  for (const line of lines) {
    const fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence && code === null) {
      flush('text');
      code = fence[1];
    } else if (fence && code !== null) {
      flush('code', code);
      code = null;
    } else {
      buf.push(line);
    }
  }
  if (code !== null) flush('code', code);
  else flush('text');
  return parts;
}

const agentBubble = (text, streaming) => ({ kind: 'agent', text, blocks: splitFences(text), streaming });

function eventToViewModel(evt) {
  switch (evt.type) {
    case 'message':
      return evt.role === 'user' ? { kind: 'user', text: evt.text, ts: evt.ts } : agentBubble(evt.text, false);
    case 'delta':
      return { kind: 'delta', text: evt.text };
    case 'tool_start':
      return { kind: 'tool', toolUseId: evt.toolUseId, tag: String(evt.tool).toLowerCase(), summary: evt.summary, state: 'running', output: '' };
    case 'tool_end':
      return { kind: 'tool_end', toolUseId: evt.toolUseId, isError: evt.isError, output: evt.output };
    case 'approval_request':
      return {
        kind: 'approval',
        requestId: evt.requestId,
        tool: evt.tool,
        summary: evt.summary,
        reason: evt.reason,
        choices: CHOICES.filter((c) => c.decision !== 'session' || evt.grantable),
        resolved: null,
      };
    case 'approval_resolved':
      return { kind: 'approval_resolved', requestId: evt.requestId, decision: evt.decision };
    case 'error':
      return { kind: 'error', text: evt.message };
    default:
      return null;
  }
}

// Close an open streaming bubble (turn ended, a tool started) without losing its text.
function closeStream(items) {
  const last = items[items.length - 1];
  if (!last || last.kind !== 'agent' || !last.streaming) return items;
  return [...items.slice(0, -1), { ...last, streaming: false }];
}

// items + event -> new items. Never mutates its input.
function reduceChat(items, evt) {
  if (evt.type === 'status') return TURN_OVER.includes(evt.to) ? closeStream(items) : items;
  const vm = eventToViewModel(evt);
  if (!vm) return items;
  const last = items[items.length - 1];
  const streaming = last && last.kind === 'agent' && last.streaming;

  switch (vm.kind) {
    case 'delta':
      if (streaming) return [...items.slice(0, -1), agentBubble(last.text + vm.text, true)];
      return [...items, agentBubble(vm.text, true)];
    case 'agent':
      // The full message replaces the bubble its deltas built.
      if (streaming) return [...items.slice(0, -1), vm];
      return [...items, vm];
    case 'tool_end': {
      const i = items.findIndex((x) => x.kind === 'tool' && x.toolUseId === vm.toolUseId);
      const state = vm.isError ? 'error' : 'done';
      if (i < 0) return [...items, { kind: 'tool', toolUseId: vm.toolUseId, tag: 'tool', summary: '', state, output: vm.output }];
      return items.map((x, j) => (j === i ? { ...x, state, output: vm.output } : x));
    }
    case 'approval_resolved':
      return items.map((x) => (x.kind === 'approval' && x.requestId === vm.requestId ? { ...x, resolved: vm.decision } : x));
    default:
      return [...closeStream(items), vm];
  }
}

if (typeof module !== 'undefined') module.exports = { eventToViewModel, reduceChat, splitFences };
