// The owner's Claude Code skills (settings spec §4.4): ~/.claude/skills and the
// skills of installed plugins. Read-only, main process only. Only the `name:`
// and `description:` frontmatter lines are parsed; a folder without them is
// not a skill.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isInside, isCredentialPath } = require('./policy/paths.js');

const MAX_FILE = 100 * 1024;
const MAX_DESCRIPTION = 500;

const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');

// { name, description } from the leading --- block, or null.
function parseFrontmatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const out = {};
  for (let i = 1; i < end; i++) {
    const m = /^(name|description):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    // Folded or literal block: the indented lines that follow.
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block = [];
      while (i + 1 < end && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(' ');
    }
    out[m[1]] = unquote(value);
  }
  return out.name ? { name: out.name, description: (out.description ?? '').slice(0, MAX_DESCRIPTION) } : null;
}

// Skills directly under `root`: one folder each, with a SKILL.md.
function skillsIn(root, source) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const dir = path.join(root, e.name);
    let meta = null;
    try {
      meta = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
    } catch {
      // No SKILL.md: not a skill.
    }
    if (meta) out.push({ id: `${source}:${meta.name}`, name: meta.name, description: meta.description, source, dir });
  }
  return out;
}

// Plugins come from installed_plugins.json ({ plugins: { "name@marketplace": [{ installPath }] } });
// their skills live in <installPath>/skills/<skill>/SKILL.md.
function pluginRoots(pluginsDir) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'installed_plugins.json'), 'utf8'));
  } catch {
    return [];
  }
  const roots = [];
  for (const [key, installs] of Object.entries(data?.plugins ?? {})) {
    const install = Array.isArray(installs) ? installs.find((x) => typeof x?.installPath === 'string') : null;
    if (install) roots.push({ source: key.split('@')[0], root: path.join(install.installPath, 'skills') });
  }
  return roots.sort((a, b) => a.source.localeCompare(b.source));
}

function listSkills({ home = os.homedir(), pluginsDir = path.join(home, '.claude', 'plugins') } = {}) {
  const all = [
    ...skillsIn(path.join(home, '.claude', 'skills'), 'user'),
    ...pluginRoots(pluginsDir).flatMap((p) => skillsIn(p.root, p.source)),
  ];
  const seen = new Set();
  return all.filter((s) => !seen.has(s.id) && seen.add(s.id));
}

// A file inside the skill's folder. Throws an Error with the reason in Indonesian.
function readSkillFile(skill, relPath = 'SKILL.md') {
  const rel = String(relPath);
  if (!rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.startsWith('\\\\') || rel.startsWith('//')) {
    throw new Error(`Path skill harus relatif terhadap folder skill: ${rel}`);
  }
  if (isCredentialPath(rel)) throw new Error(`Diblokir: ${rel} adalah file kredensial.`);
  const target = path.resolve(skill.dir, rel);
  if (!isInside(skill.dir, target)) throw new Error(`Diblokir: ${rel} ada di luar folder skill.`);
  let real;
  try {
    real = fs.realpathSync.native(target);
  } catch {
    throw new Error(`File skill tidak ditemukan: ${rel}`);
  }
  // realpath follows junctions and symlinks; the real file must still be inside.
  if (!isInside(skill.dir, real)) throw new Error(`Diblokir: ${rel} ada di luar folder skill.`);
  if (isCredentialPath(real)) throw new Error(`Diblokir: ${rel} adalah file kredensial.`);
  if (!fs.statSync(real).isFile()) throw new Error(`Bukan file: ${rel}`);
  const buf = fs.readFileSync(real);
  if (buf.length <= MAX_FILE) return buf.toString('utf8');
  return `${buf.subarray(0, MAX_FILE).toString('utf8')}\n… (dipotong, ${buf.length} byte)`;
}

// The name Claude Code's Skill tool uses: plugin skills are namespaced.
function claudeSkillName(skill) {
  return skill.source === 'user' ? skill.name : `${skill.source}:${skill.name}`;
}

module.exports = { listSkills, readSkillFile, claudeSkillName, MAX_FILE };
