// Conservative shell classifier (spec §5, best effort). Anything it does not
// recognise with certainty is 'unknown', which the policy turns into ask/deny.

// Chaining, redirects, pipes, subshells, and variable expansion in bash, cmd
// and PowerShell. Their presence anywhere makes the command unknown.
const UNSAFE = /[&|;<>`$()%^\r\n]/;

function tokenize(cmd) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) tokens.push(m[1] ?? m[2] ?? m[3]);
  const quotes = (cmd.match(/"/g) || []).length + (cmd.match(/'/g) || []).length;
  return quotes % 2 === 0 ? tokens : null;
}

function program(token) {
  return token.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
}

const result = (cls, isTest = false) => ({ class: cls, isTest });
const UNKNOWN = result('unknown');

function classifyNode(args) {
  if (args[0] !== '--test') return UNKNOWN;
  // Only test files/dirs and --test-* flags; anything else could load code.
  const ok = args.slice(1).every((a) => !a.startsWith('-') || a.startsWith('--test-'));
  return ok ? result('safe-test', true) : UNKNOWN;
}

function classifyPackageManager(pm, args) {
  const [sub, next] = args;
  if (sub === 'test' || sub === 't') return result('safe-test', true);
  if (sub === 'run' && next && /^test(:|$)/.test(next)) return result('safe-test', true);
  if (pm === 'yarn' && sub === undefined) return result('install');
  if (['i', 'install', 'add', 'ci'].includes(sub)) return result('install');
  return UNKNOWN;
}

const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'blame', 'grep', 'ls-files', 'rev-parse', 'describe', 'shortlog']);
const GIT_WRITE = new Set(['add', 'commit', 'checkout', 'switch', 'restore', 'merge', 'cherry-pick', 'revert', 'stash', 'tag', 'fetch', 'pull', 'mv', 'branch', 'reset']);
const BRANCH_LIST_FLAGS = new Set(['-a', '-r', '-v', '-vv', '--list', '--all', '--remotes', '--show-current']);

function classifyGit(args) {
  const [sub, ...rest] = args;
  // Global options (-C, -c, --git-dir, ...) can redirect or reconfigure git.
  if (!sub || sub.startsWith('-')) return UNKNOWN;

  if (sub === 'push') {
    const force = rest.some((a) => a === '--force' || a.startsWith('--force-') || /^-[a-z]*f/.test(a) || a.startsWith('+'));
    return result(force ? 'git-force' : 'git-push');
  }
  if (sub === 'rebase' || sub === 'filter-branch' || sub === 'filter-repo') return result('history-rewrite');
  if (sub === 'commit' && rest.includes('--amend')) return result('history-rewrite');
  if (sub === 'reflog' && rest[0] === 'expire') return result('history-rewrite');
  if (sub === 'reset' && rest.some((a) => ['--hard', '--soft', '--keep', '--merge'].includes(a))) return result('history-rewrite');
  if (sub === 'rm' || sub === 'clean') return result('delete');
  if (sub === 'branch' && rest.every((a) => BRANCH_LIST_FLAGS.has(a))) return result('git-read');
  if (sub === 'reflog' && rest.length === 0) return result('git-read');
  if (GIT_READ.has(sub)) return result('git-read');
  if (GIT_WRITE.has(sub)) return result('git-write');
  return UNKNOWN;
}

function classifyShell(cmd) {
  const text = String(cmd ?? '').trim();
  if (!text || UNSAFE.test(text)) return UNKNOWN;
  const tokens = tokenize(text);
  if (!tokens || !tokens.length) return UNKNOWN;
  const [first, ...args] = tokens;
  const prog = program(first);

  if (prog === 'git') return classifyGit(args);
  if (prog === 'node') return classifyNode(args);
  if (prog === 'npm' || prog === 'pnpm' || prog === 'yarn') return classifyPackageManager(prog, args);
  if (prog === 'npx' || prog === 'pnpx' || prog === 'winget' || prog === 'choco' || prog === 'scoop') return result('install');
  if (prog === 'pip' || prog === 'pip3') return args[0] === 'install' ? result('install') : UNKNOWN;
  if (prog === 'pytest') return result('safe-test', true);
  if (prog === 'python' || prog === 'python3' || prog === 'py') {
    if (args[0] === '-m' && args[1] === 'pytest') return result('safe-test', true);
    if (args[0] === '-m' && args[1] === 'pip' && args[2] === 'install') return result('install');
    return UNKNOWN;
  }
  if ((prog === 'go' || prog === 'cargo') && args[0] === 'test') return result('safe-test', true);
  if ((prog === 'go' && (args[0] === 'install' || args[0] === 'get')) || (prog === 'cargo' && args[0] === 'install')) return result('install');
  if (['rm', 'del', 'erase', 'rmdir', 'rd', 'remove-item', 'unlink', 'rimraf'].includes(prog)) return result('delete');
  return UNKNOWN;
}

module.exports = { classifyShell, tokenize };
