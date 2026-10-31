// Pure mapping from one claude stream-json stdout line to Zonder events.
// Returns an array of partial events (the agent adds agentId; the store adds ts),
// a {control} item for permission requests, or [] for anything else.
//
// Internal event types the agent consumes and does not forward as-is:
//   {type:'session', sessionId}, {type:'status', to}, {type:'turn_end', interrupted}

const { classifyShell } = require('../policy/shell.js');

const OUTPUT_CAP = 8000;
const INPUT_FIELD_CAP = 2000;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

const cap = (text, max) => (text.length > max ? `${text.slice(0, max)}\n… (dipotong, ${text.length} karakter)` : text);

// For display and history only. Approvals use the untouched input from the control_request.
function capInput(input) {
  if (!input || typeof input !== 'object') return input;
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === 'string' ? cap(v, INPUT_FIELD_CAP) : v]));
}

function summarize(tool, input = {}) {
  const value = input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.pattern ?? input.url ?? input.description;
  return String(value ?? JSON.stringify(input)).slice(0, 200);
}

function toolOutput(content) {
  const text = Array.isArray(content)
    ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
    : String(content ?? '');
  return cap(text, OUTPUT_CAP);
}

function fromAssistant(msg) {
  const events = [];
  for (const block of msg.message?.content ?? []) {
    if (block.type === 'text' && block.text) {
      events.push({ type: 'message', role: 'agent', text: block.text });
    } else if (block.type === 'thinking') {
      events.push({ type: 'status', to: 'thinking' });
    } else if (block.type === 'tool_use') {
      const isTest = SHELL_TOOLS.has(block.name) && classifyShell(block.input?.command).isTest;
      events.push({ type: 'tool_start', toolUseId: block.id, tool: block.name, summary: summarize(block.name, block.input), input: capInput(block.input) });
      events.push({ type: 'status', to: isTest ? 'testing' : 'working' });
    }
  }
  return events;
}

function fromUser(msg) {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b.type === 'tool_result')
    .map((b) => ({ type: 'tool_end', toolUseId: b.tool_use_id, isError: b.is_error === true, output: toolOutput(b.content) }));
}

function fromResult(msg) {
  if (msg.subtype === 'success' && !msg.is_error) return [{ type: 'status', to: 'done' }, { type: 'turn_end', interrupted: false }];
  // Our own interrupt: the turn stops, the process and session stay alive.
  if (msg.terminal_reason === 'aborted_streaming') return [{ type: 'status', to: 'idle' }, { type: 'turn_end', interrupted: true }];
  return [{ type: 'error', message: String(msg.result || msg.subtype || 'Giliran gagal') }, { type: 'status', to: 'idle' }, { type: 'turn_end', interrupted: false }];
}

function parseLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return [];

  switch (msg.type) {
    case 'system':
      return msg.subtype === 'init' && msg.session_id ? [{ type: 'session', sessionId: msg.session_id }] : [];
    case 'assistant':
      return fromAssistant(msg);
    case 'user':
      return fromUser(msg);
    case 'result':
      return fromResult(msg);
    case 'control_request':
      if (msg.request?.subtype !== 'can_use_tool') return [];
      return { control: { requestId: msg.request_id, tool: msg.request.tool_name, toolUseId: msg.request.tool_use_id, input: msg.request.input } };
    default:
      return [];
  }
}

module.exports = { parseLine, summarize };
