// Claude Code CLI status for Settings → Providers: installed, version, logged in.
// Runs claude.exe directly (as claude-agent.js does), only `--version` and
// `auth status --json`, which never start a login. Only the loggedIn flag leaves
// this module: auth status also prints the account email and organisation.

const childProcess = require('node:child_process');
const { resolveClaudeExe } = require('./agents/claude-agent.js');

const TIMEOUT_MS = 10000;

function run(execFile, exe, args) {
  return new Promise((resolve) => {
    execFile(exe, args, { timeout: TIMEOUT_MS, windowsHide: true, encoding: 'utf8' }, (err, stdout) => resolve({ err, stdout: String(stdout ?? '') }));
  });
}

async function checkClaude({ execFile = childProcess.execFile, resolveExe = resolveClaudeExe } = {}) {
  const missing = { installed: false, version: null, loggedIn: null, error: 'Claude Code CLI tidak ditemukan.' };
  const exe = resolveExe();
  if (!exe) return missing;

  const v = await run(execFile, exe, ['--version']);
  if (v.err) return v.err.code === 'ENOENT' ? missing : { installed: false, version: null, loggedIn: null, error: `claude --version gagal: ${v.err.message}` };
  const version = v.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null;

  let loggedIn = null;
  const a = await run(execFile, exe, ['auth', 'status', '--json']);
  if (!a.err) {
    try {
      const parsed = JSON.parse(a.stdout);
      if (typeof parsed.loggedIn === 'boolean') loggedIn = parsed.loggedIn;
    } catch {
      // Unknown output: login state stays unknown.
    }
  }
  return { installed: true, version, loggedIn, error: null };
}

module.exports = { checkClaude };
