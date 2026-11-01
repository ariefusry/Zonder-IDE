// Local tools for 9router agents (spec §3.2). The router only routes; Zonder
// runs these inside the agent's worktree. RouterAgent asks the policy first
// (Approvals -> decide); execTool repeats the path checks on its own, so a
// wiring mistake can never reach outside the worktree.

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { isInside, isCredentialPath } = require('../policy/paths.js');
const { killTree } = require('./claude-agent.js');

const OUTPUT_CAP = 20000;
const COMMAND_TIMEOUT_MS = 60000;
// Well above the cap: hitting maxBuffer kills the child instead of truncating.
const MAX_BUFFER = 10 * 1024 * 1024;

const fn = (name, description, properties, required) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

const TOOLS = [
  fn('read_file', 'Baca file teks di dalam worktree.', { path: { type: 'string', description: 'Path relatif terhadap root worktree.' } }, ['path']),
  fn('list_dir', 'Daftar isi folder di dalam worktree. Folder diakhiri "/".', { path: { type: 'string', description: 'Path relatif; kosong berarti root worktree.' } }, []),
  fn('write_file', 'Tulis (atau timpa) file teks di dalam worktree. Folder induk dibuat bila perlu.', {
    path: { type: 'string', description: 'Path relatif terhadap root worktree.' },
    content: { type: 'string', description: 'Isi lengkap file.' },
  }, ['path', 'content']),
  fn('run_command', 'Jalankan satu perintah cmd.exe di root worktree. Batas waktu 60 detik.', { command: { type: 'string', description: 'Perintah, misalnya npm test.' } }, ['command']),
];

const isText = (v) => typeof v === 'string' && v.length > 0;

// Tool call arguments -> policy Action, or null when the arguments are not
// usable. Null must never reach decide(): a read with no path would be allowed.
function toAction(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  switch (name) {
    case 'read_file':
      return isText(args.path) ? { kind: 'read', tool: name, path: args.path, summary: args.path } : null;
    case 'list_dir': {
      if (args.path !== undefined && typeof args.path !== 'string') return null;
      const p = args.path || '.';
      return { kind: 'read', tool: name, path: p, summary: p };
    }
    case 'write_file':
      return isText(args.path) && typeof args.content === 'string' ? { kind: 'write', tool: name, path: args.path, summary: args.path } : null;
    case 'run_command':
      return isText(args.command) && args.command.trim() ? { kind: 'shell', tool: name, command: args.command, summary: args.command } : null;
    default:
      return null;
  }
}

const cap = (text) => (text.length > OUTPUT_CAP ? `${text.slice(0, OUTPUT_CAP)}\n… (dipotong, ${text.length} karakter)` : text);

function resolveInside(worktree, p) {
  if (isCredentialPath(p)) throw new Error(`Diblokir: ${p} adalah file kredensial.`);
  const abs = p.startsWith('\\\\') || p.startsWith('//') ? p : path.resolve(worktree, p);
  if (!isInside(worktree, abs)) throw new Error(`Diblokir: ${p} ada di luar worktree agent.`);
  return abs;
}

// Ends early, killing the whole tree, on timeout or when `signal` aborts
// (interrupt or stop); either way the result says so.
function runCommand(command, { worktree, signal, execFile = childProcess.execFile, kill = killTree, timeoutMs = COMMAND_TIMEOUT_MS }) {
  if (signal?.aborted) return Promise.resolve('Dibatalkan: giliran diinterupsi.');
  return new Promise((resolve) => {
    let timer = null;
    let done = false;
    let child = null;
    const finish = (text) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(text);
    };
    // execFile's own timeout kills only cmd.exe; grandchildren (npm -> node) need the tree.
    const end = (text) => {
      if (done) return;
      Promise.resolve(child?.pid && kill(child.pid)).then(() => finish(text));
    };
    function onAbort() {
      end('Dibatalkan: giliran diinterupsi, perintah dihentikan.');
    }
    // /s strips the outer quotes again, so cmd sees exactly what decide() saw.
    child = execFile('cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
      cwd: worktree, windowsHide: true, windowsVerbatimArguments: true, maxBuffer: MAX_BUFFER, encoding: 'utf8',
    }, (err, stdout, stderr) => {
      const out = [String(stdout ?? ''), String(stderr ?? '')].filter((s) => s.trim()).join('\n');
      const head = err ? `Perintah gagal (kode keluar ${err.code ?? '?'}).\n` : '';
      finish(cap(head + out) || '(tanpa keluaran)');
    });
    if (done) return;
    signal?.addEventListener('abort', onAbort);
    timer = setTimeout(() => end(`Perintah dihentikan setelah ${timeoutMs / 1000} detik.`), timeoutMs);
  });
}

async function execTool(name, args, ctx) {
  switch (name) {
    case 'read_file':
      return cap(fs.readFileSync(resolveInside(ctx.worktree, args.path), 'utf8'));
    case 'list_dir': {
      const entries = fs.readdirSync(resolveInside(ctx.worktree, args.path || '.'), { withFileTypes: true });
      const names = entries.filter((e) => e.name !== '.git').map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();
      return cap(names.join('\n')) || '(folder kosong)';
    }
    case 'write_file': {
      const abs = resolveInside(ctx.worktree, args.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, args.content);
      return `File ditulis: ${path.relative(ctx.worktree, abs)} (${Buffer.byteLength(args.content)} byte)`;
    }
    case 'run_command':
      return runCommand(args.command, ctx);
    default:
      throw new Error(`Tool tidak dikenal: ${name}`);
  }
}

module.exports = { TOOLS, toAction, execTool, OUTPUT_CAP, COMMAND_TIMEOUT_MS };
