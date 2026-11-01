// decide(role, action, ctx) -> {verdict, reason, hard, grantKey?}. Pure apart
// from realpath lookups. Spec §5: enforcement is best effort, no OS sandbox.
//
// Order: hard blocks (every role, never grantable) -> role rules -> session grant.

const path = require('node:path');
const { isInside, isCredentialPath } = require('./paths.js');
const { classifyShell, tokenize } = require('./shell.js');

const ROLES = ['Senior Developer', 'Junior Developer', 'Reviewer', 'QA Engineer', 'Researcher', 'Custom'];
// Permissions of the built-in roles; mirrors BUILTIN in roles.js, which cannot be
// required here without a cycle through personas. A role name resolves to these.
const BUILTIN_POLICY = {
  'Senior Developer': { write: 'allow', shell: 'auto' },
  'Junior Developer': { write: 'ask', shell: 'ask' },
  Reviewer: { write: 'deny', shell: 'deny' },
  'QA Engineer': { write: 'tests', shell: 'auto' },
  Researcher: { write: 'deny', shell: 'deny' },
  Custom: { write: 'ask', shell: 'ask' },
};
const WRITE = ['deny', 'tests', 'ask', 'allow'];
const SHELL = ['deny', 'ask', 'auto'];

const allow = (reason) => ({ verdict: 'allow', reason, hard: false });
const deny = (reason) => ({ verdict: 'deny', reason, hard: false });
const hardDeny = (reason) => ({ verdict: 'deny', reason, hard: true });
const ask = (reason, grantKey) => ({ verdict: 'ask', reason, hard: false, ...(grantKey ? { grantKey } : {}) });

function pathBlock(p, ctx) {
  if (isCredentialPath(p)) return hardDeny(`Diblokir: ${p} adalah file kredensial.`);
  // Relative paths belong to the agent's cwd, which is the worktree.
  const abs = p.startsWith('\\\\') || p.startsWith('//') ? p : path.resolve(ctx.worktree, p);
  if (isInside(ctx.mainRepo, abs)) return hardDeny(`Diblokir: ${p} ada di checkout utama.`);
  if (!isInside(ctx.worktree, abs)) return hardDeny(`Diblokir: ${p} ada di luar worktree agent.`);
  return null;
}

// Best effort: shell arguments that look like paths get the same checks as file tools.
function shellPathBlock(command, ctx) {
  for (let token of tokenize(String(command)) || []) {
    if (/\s/.test(token) || /^[a-z][a-z0-9+.-]*:\/\//i.test(token)) continue;
    token = token.replace(/^--?[^=]+=/, '');
    if (token.startsWith('~')) return hardDeny(`Diblokir: ${token} menunjuk ke luar worktree agent.`);
    const looksLikePath = /[\\/]/.test(token) || token.startsWith('.') || /^[a-z]:/i.test(token);
    if (!looksLikePath) continue;
    const block = pathBlock(token, ctx);
    if (block) return block;
  }
  return null;
}

const isTestFile = (p) => /(^|[\\/])(tests?|__tests__)[\\/]|\.(test|spec)\.[^\\/]+$/i.test(p);

function decideFile(p, action, ctx) {
  if (action.kind === 'read') return allow('Baca file di dalam worktree.');
  if (!action.path) return deny('Path tidak diketahui, aksi ditolak.');
  if (p.write === 'deny') return deny(`${p.name} hanya boleh membaca.`);
  if (p.write === 'tests' && !isTestFile(action.path)) return deny(`${p.name} hanya boleh mengubah file tes, bukan kode produksi.`);
  if (action.kind === 'delete') return ask('Menghapus file selalu bertanya.');
  if (p.write === 'allow') return allow(`${p.name} boleh menulis di worktree.`);
  return ask(`${p.name} butuh persetujuan untuk menulis.`, true);
}

// install, git push, and delete ask without a grant key, so "allow for this
// session" never covers them (spec §12a).
function decideShell(p, cls) {
  if (p.shell === 'deny') return deny(`${p.name} tidak mendapat akses shell.`);
  if (cls.class === 'install') return ask('Memasang paket selalu bertanya.');
  if (cls.class === 'git-push') return ask('Git push selalu bertanya.');
  if (cls.class === 'delete') return ask('Menghapus selalu bertanya.');
  const trusted = p.shell === 'auto';
  if (trusted && cls.class === 'safe-test') return allow('Perintah tes yang dikenali.');
  if (trusted && cls.class === 'git-read') return allow('Perintah Git hanya-baca.');
  if (cls.class === 'unknown') return ask('Perintah tidak dikenali, butuh persetujuan.', true);
  return ask(`${p.name} butuh persetujuan untuk perintah ini.`, true);
}

function grantKeyFor(action, ctx) {
  if (action.kind === 'shell') return `${action.tool}:${String(action.command).trim().replace(/\s+/g, ' ')}`;
  return `${action.tool}:${action.path ? path.resolve(ctx.worktree, action.path).toLowerCase() : ''}`;
}

// A role name (built-in) or a RolePolicy object {name, write, shell} from roles.js.
function policyOf(role) {
  if (typeof role === 'string') return BUILTIN_POLICY[role] ? { name: role, ...BUILTIN_POLICY[role] } : null;
  if (role && typeof role === 'object' && WRITE.includes(role.write) && SHELL.includes(role.shell)) return { name: String(role.name ?? 'Peran'), write: role.write, shell: role.shell };
  return null;
}

function decide(role, action, ctx) {
  const p = policyOf(role);
  if (!p) return deny(`Peran tidak dikenal: ${typeof role === 'string' ? role : role?.name ?? '?'}.`);

  let d;
  if (action.kind === 'shell') {
    const cls = classifyShell(action.command);
    if (cls.class === 'git-force') return hardDeny('Diblokir: force push tidak pernah diizinkan.');
    if (cls.class === 'history-rewrite') return hardDeny('Diblokir: menulis ulang riwayat Git tidak pernah diizinkan.');
    const block = shellPathBlock(action.command, ctx);
    if (block) return block;
    d = decideShell(p, cls);
  } else if (action.kind === 'read' || action.kind === 'write' || action.kind === 'delete') {
    const block = action.path ? pathBlock(action.path, ctx) : null;
    if (block) return block;
    d = decideFile(p, action, ctx);
  } else {
    d = ask(`Tool tidak dikenal: ${action.tool}.`, true);
  }

  if (d.verdict !== 'ask' || !d.grantKey) return d;
  const key = grantKeyFor(action, ctx);
  if (ctx.sessionGrants.has(key)) return allow('Diizinkan untuk sesi ini.');
  return { ...d, grantKey: key };
}

module.exports = { decide, ROLES };
