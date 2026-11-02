// Roles as data (settings spec §4.3, §5). Built-in roles come from a fixed table
// and PERSONAS; roles.json stores only the owner's edits to them and the owner's
// own roles. Hard blocks are not here: decide() applies them to every role.

const fs = require('node:fs');
const path = require('node:path');
const { PERSONAS } = require('./personas.js');

const WRITE = ['deny', 'tests', 'ask', 'allow'];
const SHELL = ['deny', 'ask', 'auto'];
const MAX_NAME = 40;
const MAX_PERSONA = 20000;
const MAX_SKILLS = 200;

// Same verdicts as the fixed rules before roles became data (tests/decide.test.js).
const BUILTIN = [
  { name: 'Senior Developer', write: 'allow', shell: 'auto' },
  { name: 'Junior Developer', write: 'ask', shell: 'ask' },
  { name: 'Reviewer', write: 'deny', shell: 'deny' },
  { name: 'QA Engineer', write: 'tests', shell: 'auto' },
  { name: 'Researcher', write: 'deny', shell: 'deny' },
  { name: 'Custom', write: 'ask', shell: 'ask' },
];
const BUILTIN_NAMES = BUILTIN.map((r) => r.name);

function builtinDefault(name) {
  const b = BUILTIN.find((r) => r.name === name);
  return { name, builtin: true, persona: PERSONAS[name] ?? '', write: b.write, shell: b.shell, skills: null, disableSkills: false };
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

// Validates the editable fields; returns them clean. Throws an Indonesian message.
function clean(role) {
  if (typeof role.persona !== 'string' || role.persona.length > MAX_PERSONA) throw new Error(`Persona harus teks, paling banyak ${MAX_PERSONA} karakter.`);
  if (!WRITE.includes(role.write)) throw new Error('Izin tulis tidak dikenal.');
  if (!SHELL.includes(role.shell)) throw new Error('Izin shell tidak dikenal.');
  // null = every skill: Claude agents block none; 9router agents still load only picked ones.
  if (role.skills === null) return { persona: role.persona, write: role.write, shell: role.shell, skills: null, disableSkills: Boolean(role.disableSkills) };
  const skills = role.skills ?? [];
  if (!Array.isArray(skills) || skills.length > MAX_SKILLS || !skills.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 200)) throw new Error('Skill harus daftar nama skill.');
  return { persona: role.persona, write: role.write, shell: role.shell, skills: [...new Set(skills)], disableSkills: Boolean(role.disableSkills) };
}

function createRoles({ dir = null } = {}) {
  const file = dir ? path.join(dir, 'roles.json') : null;
  // { edits: {name: fields}, custom: [Role] }
  let data = { edits: {}, custom: [] };

  if (file) {
    let text = null;
    try {
      text = fs.readFileSync(file, 'utf8');
      // Notepad and some editors save a BOM, which JSON.parse refuses.
      const raw = JSON.parse(text.replace(/^\uFEFF/, ''));
      // Anything unusable is dropped; the built-ins always remain.
      for (const [name, fields] of Object.entries(raw?.edits ?? {})) {
        if (!BUILTIN_NAMES.includes(name)) continue;
        try {
          const f = clean(fields);
          // Files from before version 2 saved [] for "never picked"; built-ins now mean every skill.
          if (!raw.version && Array.isArray(f.skills) && !f.skills.length) f.skills = null;
          data.edits[name] = f;
        } catch {}
      }
      for (const r of Array.isArray(raw?.custom) ? raw.custom : []) {
        try {
          if (typeof r.name === 'string' && !BUILTIN_NAMES.some((b) => sameName(b, r.name)) && !data.custom.some((c) => sameName(c.name, r.name))) {
            data.custom.push({ name: r.name, builtin: false, ...clean(r) });
          }
        } catch {}
      }
    } catch {
      data = { edits: {}, custom: [] };
      // Keep an unreadable file before the next save replaces it, so custom
      // roles can be recovered by hand.
      if (text !== null) try { fs.copyFileSync(file, `${file}.bad`); } catch {}
    }
  }

  function persist(next) {
    if (file) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 2, ...next }, null, 2));
      fs.renameSync(tmp, file);
    }
    data = next;
  }

  function list() {
    const builtins = BUILTIN_NAMES.map((name) => ({ ...builtinDefault(name), ...data.edits[name] }));
    return [...builtins, ...data.custom.map((r) => ({ ...r, skills: r.skills ? [...r.skills] : null }))];
  }

  function get(name) {
    if (typeof name !== 'string') return null;
    return list().find((r) => r.name === name) ?? null;
  }

  // A role with isNew must not collide with an existing name; without it, an
  // existing role of that name is updated (a custom role is created if missing).
  function save(role) {
    if (!role || typeof role !== 'object' || Array.isArray(role)) throw new Error('invalid role');
    const name = typeof role.name === 'string' ? role.name.trim() : '';
    if (!name || name.length > MAX_NAME) throw new Error(`Nama peran harus 1 sampai ${MAX_NAME} karakter.`);
    const fields = clean(role);
    const builtinName = BUILTIN_NAMES.find((b) => sameName(b, name));
    if (builtinName) {
      if (builtinName !== name || role.isNew) throw new Error(`Nama "${name}" dipakai peran bawaan.`);
      persist({ ...data, edits: { ...data.edits, [name]: fields } });
      return get(name);
    }
    const existing = data.custom.find((c) => sameName(c.name, name));
    if (existing && (role.isNew || existing.name !== name)) throw new Error(`Peran "${name}" sudah ada.`);
    const next = { name, builtin: false, ...fields };
    const custom = existing ? data.custom.map((c) => (c === existing ? next : c)) : [...data.custom, next];
    persist({ ...data, custom });
    return get(name);
  }

  function remove(name) {
    if (BUILTIN_NAMES.includes(name)) throw new Error('Peran bawaan tidak bisa dihapus.');
    if (!data.custom.some((c) => c.name === name)) throw new Error(`Peran tidak dikenal: ${name}`);
    persist({ ...data, custom: data.custom.filter((c) => c.name !== name) });
  }

  function reset(name) {
    if (!BUILTIN_NAMES.includes(name)) throw new Error(`"${name}" bukan peran bawaan.`);
    const edits = { ...data.edits };
    delete edits[name];
    persist({ ...data, edits });
    return get(name);
  }

  return { list, get, save, remove, reset };
}

// What goes on the agent record at spawn: decide() and the agent read this copy,
// so editing or deleting the role later does not change a running agent.
function snapshot(role) {
  return { name: role.name, write: role.write, shell: role.shell, skills: role.skills ? [...role.skills] : null, disableSkills: role.disableSkills };
}

// Resume after a relaunch uses the role as it is now (settings spec §4.3); a
// deleted role keeps the stored copy, or the built-in of that name for old records.
function policyForResume(record, roles) {
  const current = roles.get(record.role);
  if (current) return { rolePolicy: snapshot(current), roleDeleted: false };
  if (record.rolePolicy) return { rolePolicy: record.rolePolicy, roleDeleted: true };
  return { rolePolicy: null, roleDeleted: true };
}

module.exports = { createRoles, snapshot, policyForResume, WRITE, SHELL, BUILTIN_NAMES };
