// Path checks for the permission policy. Windows only (spec §11).

const fs = require('node:fs');
const path = require('node:path');

// Resolve the deepest existing ancestor through realpath (junctions, symlinks,
// 8.3 short names), then re-append the parts that do not exist yet. `..` is
// already collapsed by path.resolve, which matches Win32's lexical handling.
function realish(p) {
  const rest = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

function isInside(root, candidate) {
  const raw = String(candidate);
  // UNC shares and \\?\ \\.\ device paths are never part of a worktree.
  if (raw.startsWith('\\\\') || raw.startsWith('//')) return false;
  const resolved = path.resolve(root, raw);
  // A colon after the drive letter is an alternate data stream (or garbage).
  if (resolved.indexOf(':', 2) !== -1) return false;
  const base = realish(path.resolve(root)).toLowerCase();
  const target = realish(resolved).toLowerCase();
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isCredentialPath(p) {
  const parts = String(p).toLowerCase().split(/[\\/]+/).filter(Boolean);
  const name = parts[parts.length - 1] || '';
  if (parts.includes('.ssh') || parts.includes('.aws')) return true;
  return name.startsWith('.env')
    || name.endsWith('.pem')
    || name.endsWith('.key')
    || name.startsWith('id_rsa')
    || name.startsWith('id_ed25519')
    || name.startsWith('id_ecdsa')
    || name === '.npmrc'
    || name === '.git-credentials'
    || name.startsWith('credentials');
}

module.exports = { isInside, isCredentialPath };
