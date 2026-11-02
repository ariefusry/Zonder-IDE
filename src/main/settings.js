// App settings (settings spec §4.5–§4.7) in settings.json next to roles.json.
// Every field is validated on update and on load; a bad stored field falls back
// to its default instead of failing the whole file.

const fs = require('node:fs');
const path = require('node:path');
const { CLAUDE_ALIASES, CLAUDE_EFFORTS, isClaudeModelId } = require('./agents/claude-agent.js');
const { ROUTER_EFFORTS } = require('./agents/router-agent.js');

const CLEANUPS = ['keep', 'worktree', 'worktree+branch'];

const DEFAULTS = Object.freeze({
  workspace: { defaultRepo: null, baseBranch: 'main', stopCleanup: null },
  agent: { claude: { model: 'claude-sonnet-5-5', effort: null }, router: { model: null, effort: null }, maxToolRounds: 25, commandTimeoutSec: 60 },
  notify: { approval: true, done: true, error: true },
});

const copy = (v) => JSON.parse(JSON.stringify(v));

const intIn = (min, max, msg) => (v) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(msg);
  return v;
};
const text = (max, msg, { nullable = false } = {}) => (v) => {
  if (nullable && v === null) return null;
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(msg);
  return v.trim();
};
const oneOf = (list) => (v) => {
  if (v !== null && !list.includes(v)) throw new Error(`Effort tidak dikenal: ${v}`);
  return v;
};
const bool = (msg) => (v) => {
  if (typeof v !== 'boolean') throw new Error(msg);
  return v;
};

// Same shape as DEFAULTS; each leaf checks one value and returns it clean.
const RULES = {
  workspace: {
    defaultRepo: text(1000, 'Folder repo tidak valid.', { nullable: true }),
    baseBranch: text(200, 'Branch dasar harus 1 sampai 200 karakter.'),
    stopCleanup: (v) => {
      if (v !== null && !CLEANUPS.includes(v)) throw new Error('Pilihan berhenti tidak dikenal.');
      return v;
    },
  },
  agent: {
    claude: {
      model: (v) => {
        if (!isClaudeModelId(v)) throw new Error('Model Claude tidak dikenal.');
        return Object.hasOwn(CLAUDE_ALIASES, v) ? CLAUDE_ALIASES[v] : v;
      },
      effort: oneOf(CLAUDE_EFFORTS),
    },
    router: {
      // The router's model list can change, so any non-empty id is kept.
      model: text(200, 'Model 9router harus 1 sampai 200 karakter.', { nullable: true }),
      effort: oneOf(ROUTER_EFFORTS),
    },
    maxToolRounds: intIn(1, 100, 'Putaran tool harus bilangan bulat 1 sampai 100.'),
    commandTimeoutSec: intIn(5, 600, 'Batas waktu perintah harus bilangan bulat 5 sampai 600 detik.'),
  },
  notify: {
    approval: bool('Notifikasi harus aktif atau mati.'),
    done: bool('Notifikasi harus aktif atau mati.'),
    error: bool('Notifikasi harus aktif atau mati.'),
  },
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Applies `patch` onto `base` following `rules`. strict: unknown keys and bad
// values throw; otherwise they are skipped (loading a stored file).
function merge(base, patch, rules, strict, where = '') {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    // Own keys only: "constructor" or "toString" must not find a prototype function.
    const rule = Object.hasOwn(rules, k) ? rules[k] : null;
    const name = where ? `${where}.${k}` : k;
    if (!rule) {
      if (strict) throw new Error(`Pengaturan tidak dikenal: ${name}`);
      continue;
    }
    if (typeof rule === 'function') {
      try {
        out[k] = rule(v);
      } catch (err) {
        if (strict) throw err;
      }
    } else if (isObject(v)) {
      out[k] = merge(base[k], v, rule, strict, name);
    } else if (strict) {
      throw new Error(`Pengaturan tidak valid: ${name}`);
    }
  }
  return out;
}

function createSettings({ dir = null } = {}) {
  const file = dir ? path.join(dir, 'settings.json') : null;
  let data = copy(DEFAULTS);

  if (file) {
    try {
      // Notepad and some editors save a BOM, which JSON.parse refuses.
      const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (isObject(raw)) data = merge(data, raw, RULES, false);
    } catch {
      data = copy(DEFAULTS);
    }
  }

  function get() {
    return copy(data);
  }

  function update(patch) {
    if (!isObject(patch)) throw new Error('Pengaturan tidak valid.');
    const next = merge(data, patch, RULES, true);
    if (file) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
      fs.renameSync(tmp, file);
    }
    data = next;
    return get();
  }

  return { get, update };
}

module.exports = { createSettings, DEFAULTS, CLEANUPS };
