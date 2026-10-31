// One Claude Code process per agent, driven over stream-json on stdin/stdout.
//
// Launch: spawn claude.exe directly, never through cmd.exe or a shell. On
// Windows `claude.cmd` only forwards to the npm package's bin/claude.exe, and
// skipping cmd.exe means the persona reaches the CLI byte for byte (verified
// with `" & % ^ | < >` and a newline, Task 6 Step 3).
//
// Permissions: every tool call the CLI does not allow on its own arrives as a
// can_use_tool control_request and waits for respond(). --settings makes
// Read/Glob/Grep ask too (the CLI auto-allows them inside cwd otherwise) and
// denies credential files outright, even if Zonder answers allow.

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { parseLine } = require('./claude-parse.js');
const { IllegalTransition } = require('../store.js');

const PERMISSION_SETTINGS = {
  permissions: {
    ask: ['Read', 'Glob', 'Grep'],
    deny: [
      'Read(**/.env*)',
      'Read(**/*.pem)',
      'Read(**/*.key)',
      'Read(**/id_rsa*)',
      'Read(**/.npmrc)',
      'Read(**/.git-credentials)',
      'Read(**/credentials*)',
      'Read(**/.ssh/**)',
      'Read(**/.aws/**)',
    ],
  },
};

// Event types kept in the agent's chat history; status changes are not.
const PERSISTED = new Set(['message', 'tool_start', 'tool_end', 'error', 'exit']);
const STDERR_KEEP = 4000;

function buildArgs(record) {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'manual',
    '--permission-prompt-tool', 'stdio',
    '--strict-mcp-config',
    '--settings', JSON.stringify(PERMISSION_SETTINGS),
    '--model', record.model,
  ];
  if (record.persona && record.persona.trim()) args.push('--append-system-prompt', record.persona);
  if (record.sessionId) args.push('--resume', record.sessionId);
  return args;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveClaudeExe(searchPath = process.env.PATH ?? process.env.Path ?? '') {
  for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const candidate of [path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), path.join(dir, 'claude.exe')]) {
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function killTree(pid, execFile = childProcess.execFile) {
  return new Promise((resolve) => {
    // A failure here usually means the process is already gone.
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => resolve());
  });
}

// User hooks pointing at a local server print this on every session; it is not a Claude failure.
const isBenignStderr = (line) => /hook/i.test(line) && /localhost|127\.0\.0\.1/.test(line);

class ClaudeAgent {
  constructor({ record, store, persistence, onApproval, spawn = childProcess.spawn, kill = killTree, resolveExe = resolveClaudeExe, doneIdleMs = 30000, startQuietMs = 5000 }) {
    this.record = record;
    this.store = store;
    this.persistence = persistence;
    this.onApproval = onApproval;
    this.spawn = spawn;
    this.kill = kill;
    this.resolveExe = resolveExe;
    this.doneIdleMs = doneIdleMs;
    this.startQuietMs = startQuietMs;

    this.child = null;
    this.stdoutBuf = '';
    this.stderrTail = '';
    this.turnActive = false;
    this.queue = [];
    this.pending = new Map();
    this.interrupts = 0;
    this.startTimer = null;
    this.idleTimer = null;
  }

  async start() {
    if (this.child) return;
    this.setStatus('starting');
    const exe = this.resolveExe();
    if (!exe) {
      this.emitEvent({ type: 'error', message: 'Claude Code tidak ditemukan. Pasang dengan npm i -g @anthropic-ai/claude-code lalu coba lagi.' });
      this.setStatus('error');
      return;
    }

    const child = this.spawn(exe, buildArgs(this.record), { cwd: this.record.worktreePath, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.stdoutBuf = '';
    this.stderrTail = '';

    // Error handlers go on before the first write, so a dead pipe never throws.
    child.stdin.on('error', () => {});
    child.on('error', (err) => this.onExit(child, null, null, err));
    child.on('exit', (code, signal) => this.onExit(child, code, signal));

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onStdout(child, chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_KEEP);
    });

    // The CLI may say nothing until the first message, so silence also counts as ready.
    this.startTimer = setTimeout(() => this.markReady(), this.startQuietMs);
  }

  send(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Pesan kosong.');
    if (!this.child) throw new Error('Agen belum berjalan.');
    const queued = this.turnActive;
    this.emitEvent({ type: 'message', role: 'user', text, queued });
    if (queued) this.queue.push(text);
    else this.writeUser(text);
  }

  respond(requestId, decision, input, message) {
    const req = this.pending.get(requestId);
    if (!req || !this.child) return;
    this.pending.delete(requestId);
    const response = decision === 'allow'
      ? { behavior: 'allow', updatedInput: input ?? req.input }
      : { behavior: 'deny', message: message || 'Ditolak oleh pemilik.' };
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  }

  interrupt() {
    if (!this.child || !this.turnActive) return;
    this.write({ type: 'control_request', request_id: `zonder-int-${++this.interrupts}`, request: { subtype: 'interrupt' } });
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.clearTimers();
    this.queue = [];
    this.pending.clear();
    this.turnActive = false;
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(resolve, 5000).unref?.();
      });
      await this.kill(child.pid);
      await exited;
    }
    this.setStatus('stopped');
  }

  // --- internals ---

  markReady() {
    clearTimeout(this.startTimer);
    this.startTimer = null;
    if (this.record.status === 'starting') this.setStatus('idle');
  }

  onStdout(child, chunk) {
    if (this.child !== child) return;
    this.markReady();
    this.stdoutBuf += chunk;
    let nl;
    while ((nl = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, nl).replace(/\r$/, '');
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (line.trim()) this.handleLine(line);
    }
  }

  handleLine(line) {
    const parsed = parseLine(line);
    if (parsed.control) {
      this.pending.set(parsed.control.requestId, parsed.control);
      this.onApproval?.({ agentId: this.record.id, ...parsed.control });
      return;
    }
    for (const evt of parsed) this.handleEvent(evt);
  }

  handleEvent(evt) {
    switch (evt.type) {
      case 'session':
        this.record.sessionId = evt.sessionId;
        return;
      case 'status':
        this.setStatus(evt.to);
        return;
      case 'turn_end':
        this.endTurn();
        return;
      default:
        this.emitEvent(evt);
    }
  }

  endTurn() {
    this.turnActive = false;
    // The CLI drops unanswered permission requests when the turn ends.
    this.pending.clear();
    if (this.queue.length) {
      this.writeUser(this.queue.shift());
      return;
    }
    if (this.record.status === 'done') {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (this.record.status === 'done') this.setStatus('idle');
      }, this.doneIdleMs);
    }
  }

  writeUser(text) {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.turnActive = true;
    this.write({ type: 'user', message: { role: 'user', content: text } });
    this.setStatus('thinking');
  }

  write(obj) {
    this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  onExit(child, code, signal, err) {
    // stop() clears this.child first, so an exit it caused lands here and is ignored.
    if (this.child !== child) return;
    this.child = null;
    this.clearTimers();
    this.turnActive = false;
    this.pending.clear();

    this.emitEvent({ type: 'exit', code, signal });
    const tail = this.stderrTail.split(/\r?\n/).filter((l) => l.trim() && !isBenignStderr(l)).slice(-10).join('\n');
    const reason = err ? err.message : `kode ${code ?? signal}`;
    this.emitEvent({ type: 'error', message: tail ? `Claude berhenti (${reason}):\n${tail}` : `Claude berhenti tanpa diduga (${reason}).` });
    if (this.queue.length) {
      const list = this.queue.map((t) => `"${t.length > 80 ? `${t.slice(0, 80)}…` : t}"`).join(', ');
      this.emitEvent({ type: 'error', message: `${this.queue.length} pesan tidak terkirim: ${list}` });
      this.queue = [];
    }
    this.setStatus('error');
  }

  clearTimers() {
    clearTimeout(this.startTimer);
    clearTimeout(this.idleTimer);
    this.startTimer = null;
    this.idleTimer = null;
  }

  setStatus(to) {
    try {
      this.store.setStatus(this.record.id, to);
    } catch (err) {
      // The stream can report a status the machine does not allow from here
      // (a late result after an interrupt, say); the current status stands.
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

module.exports = { ClaudeAgent, buildArgs, resolveClaudeExe, killTree, PERMISSION_SETTINGS };
