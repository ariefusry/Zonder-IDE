// A 9router agent: an HTTP tool loop (spec §3.2). The router streams the model's
// reply; tool calls run here, inside the worktree, after the same policy check
// as Claude (Approvals -> decide), and go back as role:'tool' messages.
// Emits the same events as ClaudeAgent, so the UI does not care which it is.

const { listModels, streamChat, RouterOffline } = require('./router-client.js');
const routerTools = require('./router-tools.js');
const { COMMAND_TIMEOUT_MS } = routerTools;
const skillsModule = require('../skills.js');
const { classifyShell } = require('../policy/shell.js');
const { IllegalTransition } = require('../store.js');

const MAX_TOOL_ROUNDS = 25;
const ROUTER_EFFORTS = ['low', 'medium', 'high'];
const DEFAULT_LIMITS = { maxToolRounds: MAX_TOOL_ROUNDS, commandTimeoutSec: COMMAND_TIMEOUT_MS / 1000 };
const PERSISTED = new Set(['message', 'tool_start', 'tool_end', 'error', 'exit']);
const DISPLAY_CAP = 8000;
const INPUT_FIELD_CAP = 2000;

const cap = (text, max) => (text.length > max ? `${text.slice(0, max)}\n… (dipotong, ${text.length} karakter)` : text);

// skills: the role's skills that exist now (name + description only; the
// content is loaded through load_skill when the agent needs it).
function systemPrompt(record, skills = []) {
  const parts = [[
    'Kamu agent coding yang dijalankan Zonder.',
    `Kamu bekerja di worktree Git: ${record.worktreePath}`,
    'Pakai tool read_file, list_dir, write_file, dan run_command. Path relatif terhadap root worktree.',
    'Zonder menolak akses ke luar worktree dan beberapa aksi butuh persetujuan pemilik; bila ditolak, alasannya datang sebagai hasil tool.',
  ].join('\n')];
  if (skills.length) {
    parts.push([
      'Skill peranmu. Sebelum memakai satu skill, muat isinya dengan tool load_skill (name: nama skill). File pendukungnya dimuat dengan path relatif di folder skill itu.',
      ...skills.map((s) => (s.description ? `- ${s.name}: ${s.description}` : `- ${s.name}`)),
    ].join('\n'));
  }
  if (record.persona && record.persona.trim()) parts.push(record.persona);
  return parts.join('\n\n');
}

// Rebuild the conversation after a relaunch from the persisted chat history.
// Tool rounds are not replayed: their call ids and arguments are not stored, and a
// tool_calls message without its answers would make the router reject the request.
function replayHistory(events) {
  const messages = [];
  for (const e of events) {
    if (e.type !== 'message' || typeof e.text !== 'string' || !e.text.trim()) continue;
    if (e.role === 'user') messages.push({ role: 'user', content: e.text });
    else if (e.role === 'agent') messages.push({ role: 'assistant', content: e.text });
  }
  return messages;
}

class RouterAgent {
  constructor({ record, store, persistence, approvals, getKey, baseUrl, fetch = globalThis.fetch, tools = routerTools, toolCtx = {}, doneIdleMs = 30000, listSkills = skillsModule.listSkills, limits = () => DEFAULT_LIMITS }) {
    this.record = record;
    this.store = store;
    this.persistence = persistence;
    this.approvals = approvals;
    this.getKey = getKey;
    // A function, so a URL changed in the 9router dialog applies to running agents too.
    this.baseUrl = typeof baseUrl === 'function' ? baseUrl : () => baseUrl;
    this.fetch = fetch;
    this.tools = tools;
    this.toolCtx = toolCtx;
    // Read at the start of each turn, so a change in Settings applies to the next one.
    this.limits = limits;
    this.doneIdleMs = doneIdleMs;
    this.listSkills = listSkills;
    // The tool list of the current round (load_skill only for roles with skills).
    this.toolList = tools.TOOLS;

    // The conversation sent to the router, without the system message.
    this.messages = [];
    this.running = false;
    this.stopping = false;
    this.turnActive = false;
    this.queue = [];
    this.abort = null;
    this.idleTimer = null;
    // Resolves when the current turn and everything queued behind it is over.
    this.turn = Promise.resolve();
  }

  async start() {
    if (this.running) return;
    this.stopping = false;
    // A fresh object for a stored agent (resume after relaunch) starts from its history.
    if (!this.replayed) {
      this.replayed = true;
      if (!this.messages.length && this.persistence?.loadHistory) this.messages = replayHistory(this.persistence.loadHistory(this.record.id));
    }
    this.setStatus('starting');
    const key = await this.getKey();
    if (!key) {
      this.emitEvent({ type: 'error', message: 'Kunci 9router belum diisi. Isi lewat tombol 9router di sidebar.' });
      this.setStatus('error');
      return;
    }
    try {
      await listModels({ baseUrl: this.baseUrl(), key, fetch: this.fetch });
    } catch (err) {
      this.emitEvent({ type: 'error', message: err instanceof RouterOffline ? 'Router offline' : err.message });
      this.setStatus('error');
      return;
    }
    this.running = true;
    this.setStatus('idle');
  }

  send(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Pesan kosong.');
    if (!this.running) throw new Error('Agen belum berjalan.');
    const queued = this.turnActive;
    this.emitEvent({ type: 'message', role: 'user', text, queued });
    if (queued) {
      this.queue.push(text);
      this.emitQueue();
      return;
    }
    this.turnActive = true;
    this.turn = this.drain(text);
  }

  // Approvals owns the pending cards; this is here so both agent kinds share one shape.
  respond(requestId, decision) {
    this.approvals?.respond(requestId, decision);
  }

  setModel(model) {
    this.record.model = model;
    // The last answer came from the old choice, so its model no longer applies.
    this.record.servedModel = null;
    this.emitEvent({ type: 'model', model });
  }

  // Sent with each request, so it applies from the next one; nothing restarts.
  setEffort(effort) {
    if (effort !== null && !ROUTER_EFFORTS.includes(effort)) throw new Error(`Effort tidak dikenal: ${effort}`);
    this.record.effort = effort;
    this.emitEvent({ type: 'effort', effort, pending: false });
  }

  interrupt() {
    if (!this.turnActive) return;
    this.abort?.abort();
    this.approvals?.cancel(this.record.id, 'Giliran diinterupsi sebelum izin dijawab.');
  }

  async stop() {
    if (!this.running && !this.turnActive) {
      if (this.record.status !== 'stopped') this.setStatus('stopped');
      return;
    }
    this.running = false;
    this.stopping = true;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.dropQueue();
    this.abort?.abort();
    this.approvals?.cancel(this.record.id, 'Agent dihentikan sebelum izin dijawab.');
    await this.turn.catch(() => {});
    this.stopping = false;
    this.setStatus('stopped');
  }

  // --- internals ---

  async drain(text) {
    try {
      let first = true;
      for (let next = text; next !== undefined && !this.stopping; next = this.queue.shift()) {
        if (!first) this.emitQueue();
        first = false;
        await this.runTurn(next);
      }
    } finally {
      this.turnActive = false;
    }
  }

  async runTurn(text) {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    // After "Router offline" the next message is the retry (error -> starting -> thinking).
    if (this.record.status === 'error') this.setStatus('starting');
    this.messages.push({ role: 'user', content: text });
    this.setStatus('thinking');
    const ctrl = new AbortController();
    this.abort = ctrl;

    try {
      const { maxToolRounds: maxRounds, commandTimeoutSec } = this.limits();
      this.commandTimeoutMs = commandTimeoutSec * 1000;
      for (let rounds = 0; ; rounds++) {
        const key = await this.getKey();
        if (!key) throw new Error('Kunci 9router belum diisi. Isi lewat tombol 9router di sidebar.');
        // Skills are read again each round, so a skill installed meanwhile is seen.
        const skills = this.roleSkills();
        this.toolList = skills.length ? this.tools.toolsFor(this.record.rolePolicy) : this.tools.TOOLS;
        let reply = '';
        let calls = null;
        for await (const part of streamChat({
          baseUrl: this.baseUrl(), key, model: this.record.model, effort: this.record.effort ?? null, fetch: this.fetch, signal: ctrl.signal,
          messages: [{ role: 'system', content: systemPrompt(this.record, skills) }, ...this.messages],
          tools: this.toolList,
        })) {
          if (part.delta) {
            reply += part.delta;
            this.emitEvent({ type: 'delta', text: part.delta });
          }
          if (part.toolCalls) calls = part.toolCalls;
          if (part.servedModel && part.servedModel !== this.record.servedModel) {
            this.record.servedModel = part.servedModel;
            this.emitEvent({ type: 'servedModel', model: part.servedModel });
          }
        }
        if (reply) this.emitEvent({ type: 'message', role: 'agent', text: reply });

        if (!calls) {
          if (reply) this.messages.push({ role: 'assistant', content: reply });
          this.setStatus('done');
          break;
        }
        if (rounds >= maxRounds) {
          // The unanswered tool calls are dropped, so the next turn's history stays valid.
          if (reply) this.messages.push({ role: 'assistant', content: reply });
          this.emitEvent({ type: 'error', message: `Batas ${maxRounds} putaran tool per giliran tercapai. Giliran dihentikan.` });
          this.setStatus('idle');
          break;
        }

        calls.forEach((c, i) => { if (!c.id) c.id = `call_${rounds}_${i}`; });
        const results = [];
        for (const call of calls) {
          const content = ctrl.signal.aborted ? 'Dibatalkan: giliran diinterupsi.' : await this.runTool(call, ctrl.signal);
          results.push({ role: 'tool', tool_call_id: call.id, content });
        }
        // The assistant message and all its answers go in together, or not at all.
        this.messages.push({
          role: 'assistant',
          content: reply || null,
          tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
        }, ...results);
        if (ctrl.signal.aborted) {
          this.setStatus('idle');
          break;
        }
        this.setStatus('thinking');
      }
    } catch (err) {
      if (ctrl.signal.aborted) {
        this.setStatus('idle');
      } else if (err instanceof RouterOffline) {
        this.emitEvent({ type: 'error', message: 'Router offline' });
        this.setStatus('error');
      } else {
        this.emitEvent({ type: 'error', message: err.message });
        this.setStatus('idle');
      }
    } finally {
      this.abort = null;
    }

    if (this.record.status === 'done' && !this.queue.length) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (this.record.status === 'done') this.setStatus('idle');
      }, this.doneIdleMs);
    }
  }

  // Runs one tool call and returns the role:'tool' content. Never throws.
  async runTool(call, signal) {
    let args;
    try {
      args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
    } catch {
      args = undefined;
    }
    const known = this.toolList.some((t) => t.function.name === call.name);
    if (known && call.name === 'load_skill') return this.runLoadSkill(call, args);
    const action = known && args !== undefined ? this.tools.toAction(call.name, args) : null;
    this.emitEvent({ type: 'tool_start', toolUseId: call.id, tool: call.name, summary: action?.summary ?? call.name, input: displayInput(args) });

    let content;
    let isError = true;
    if (!known) {
      content = `Ditolak: tool tidak dikenal: ${call.name}. Tool yang ada: ${this.toolList.map((t) => t.function.name).join(', ')}.`;
    } else if (!action) {
      content = `invalid arguments: argumen ${call.name} bukan JSON yang valid atau tidak lengkap.`;
    } else {
      this.setStatus('working');
      const answer = await this.approvals.handle(this.record.id, action, { worktree: this.record.worktreePath, mainRepo: this.record.workspace });
      if (answer.behavior !== 'allow') {
        content = `Ditolak: ${answer.message || 'aksi tidak diizinkan.'}`;
      } else {
        if (action.kind === 'shell' && classifyShell(action.command).isTest) this.setStatus('testing');
        else this.setStatus('working');
        try {
          content = await this.tools.execTool(call.name, args, { worktree: this.record.worktreePath, timeoutMs: this.commandTimeoutMs, ...this.toolCtx, signal });
          isError = false;
        } catch (err) {
          content = `Gagal: ${err.message}`;
        }
      }
    }
    this.emitEvent({ type: 'tool_end', toolUseId: call.id, isError, output: cap(content, DISPLAY_CAP) });
    return content;
  }

  // The role's skills that exist now; [] when there are none or listing fails.
  roleSkills() {
    if (!this.record.rolePolicy?.skills?.length || !this.tools.skillsOf) return [];
    try {
      return this.tools.skillsOf(this.record.rolePolicy, this.listSkills());
    } catch {
      return [];
    }
  }

  // load_skill reads only the role's own skills, so it skips decide() and the approval card.
  runLoadSkill(call, args) {
    const label = args && typeof args.name === 'string' ? (args.path ? `${args.name}/${args.path}` : args.name) : 'load_skill';
    this.emitEvent({ type: 'tool_start', toolUseId: call.id, tool: call.name, summary: label, input: displayInput(args) });
    let content;
    try {
      content = this.tools.loadSkill(args, { allowed: this.record.rolePolicy?.skills ?? [], skills: this.listSkills() });
    } catch (err) {
      content = `Gagal: ${err.message}`;
    }
    const isError = /^(Ditolak|Gagal|invalid arguments|Skill tidak tersedia)/.test(content);
    this.emitEvent({ type: 'tool_end', toolUseId: call.id, isError, output: cap(content, DISPLAY_CAP) });
    return content;
  }

  emitQueue() {
    this.emitEvent({ type: 'queue', count: this.queue.length });
  }

  dropQueue() {
    if (!this.queue.length) return;
    this.queue = [];
    this.emitQueue();
  }

  setStatus(to) {
    // While stopping, only the final "stopped" counts.
    if (this.stopping && to !== 'stopped') return;
    try {
      this.store.setStatus(this.record.id, to);
    } catch (err) {
      if (!(err instanceof IllegalTransition)) throw err;
    }
  }

  emitEvent(evt) {
    const full = { agentId: this.record.id, ts: Date.now(), ...evt };
    this.store.emit(full);
    if (PERSISTED.has(evt.type)) {
      try {
        this.persistence?.appendEvent(this.record.id, full);
      } catch (err) {
        console.error('history write failed', err);
      }
    }
  }
}

function displayInput(args) {
  if (!args || typeof args !== 'object') return args;
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'string' ? cap(v, INPUT_FIELD_CAP) : v]));
}

module.exports = { RouterAgent, MAX_TOOL_ROUNDS, ROUTER_EFFORTS, systemPrompt, replayHistory };
