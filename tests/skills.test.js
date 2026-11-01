// Skills from ~/.claude/skills and installed plugins (settings plan Task 17).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listSkills, readSkillFile, claudeSkillName } = require('../src/main/skills.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-skills-'));
  const home = path.join(root, 'home');
  const user = path.join(home, '.claude', 'skills');
  const put = (p, text) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  put(path.join(user, 'ui', 'SKILL.md'), '---\nname: ui\ndescription: "Aturan UI tanpa slop."\n---\n# UI\nPakai satu aksen.\n');
  put(path.join(user, 'ui', 'references', 'a.md'), 'referensi a');
  put(path.join(user, 'ui', '.env'), 'SECRET=1');
  put(path.join(user, 'nofront', 'SKILL.md'), '# Tanpa frontmatter\n');
  fs.mkdirSync(path.join(user, 'empty'), { recursive: true });
  put(path.join(root, 'outside', 'secret.md'), 'di luar skill');
  const pluginsDir = path.join(home, '.claude', 'plugins');
  const install = path.join(pluginsDir, 'cache', 'market', 'kit', '1.0.0');
  put(path.join(install, 'skills', 'deck', 'SKILL.md'), '---\nname: deck\ndescription: >\n  Membuat slide\n  yang rapi.\n---\nIsi deck.\n');
  put(path.join(pluginsDir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'kit@market': [{ scope: 'user', installPath: install }] } }));
  return { root, home, pluginsDir, user, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('listSkills returns ui and the plugin skill with name/description from frontmatter; nofront and empty are skipped', () => {
  const f = fixture();
  try {
    const skills = listSkills({ home: f.home });
    assert.deepEqual(skills.map((s) => [s.id, s.name, s.description, s.source]), [
      ['user:ui', 'ui', 'Aturan UI tanpa slop.', 'user'],
      ['kit:deck', 'deck', 'Membuat slide yang rapi.', 'kit'],
    ]);
    assert.equal(skills[0].dir, path.join(f.user, 'ui'));
  } finally {
    f.cleanup();
  }
});

test('listSkills with no skills folder and no plugins returns an empty list', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-skills-none-'));
  try {
    assert.deepEqual(listSkills({ home }), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('listSkills skips a corrupt installed_plugins.json but keeps user skills', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.pluginsDir, 'installed_plugins.json'), '{ not json');
    assert.deepEqual(listSkills({ home: f.home }).map((s) => s.id), ['user:ui']);
  } finally {
    f.cleanup();
  }
});

test('readSkillFile(ui) returns SKILL.md; readSkillFile(ui, references/a.md) returns that file', () => {
  const f = fixture();
  try {
    const ui = listSkills({ home: f.home })[0];
    assert.match(readSkillFile(ui), /Pakai satu aksen\./);
    assert.equal(readSkillFile(ui, 'references/a.md'), 'referensi a');
    assert.equal(readSkillFile(ui, 'references\\a.md'), 'referensi a');
  } finally {
    f.cleanup();
  }
});

test('readSkillFile refuses traversal, drive and UNC paths, a junction to outside, and .env inside the skill', () => {
  const f = fixture();
  try {
    const ui = listSkills({ home: f.home })[0];
    fs.symlinkSync(path.join(f.root, 'outside'), path.join(ui.dir, 'link'), 'junction');
    const cases = [
      ['../x', /di luar folder skill/],
      ['../../../outside/secret.md', /di luar folder skill/],
      ['C:\\Windows\\win.ini', /harus relatif/],
      ['\\\\server\\share\\x', /harus relatif/],
      ['//server/share/x', /harus relatif/],
      ['link/secret.md', /di luar folder skill/],
      ['.env', /kredensial/],
      ['tidak-ada.md', /tidak ditemukan/],
    ];
    for (const [rel, reason] of cases) assert.throws(() => readSkillFile(ui, rel), reason, rel);
  } finally {
    f.cleanup();
  }
});

test('readSkillFile truncates files over 100 KB with a note', () => {
  const f = fixture();
  try {
    const ui = listSkills({ home: f.home })[0];
    fs.writeFileSync(path.join(ui.dir, 'big.md'), 'x'.repeat(150 * 1024));
    const text = readSkillFile(ui, 'big.md');
    assert.ok(text.length < 110 * 1024);
    assert.match(text, /dipotong/);
  } finally {
    f.cleanup();
  }
});

test('claudeSkillName: user skills by name, plugin skills as plugin:name', () => {
  assert.equal(claudeSkillName({ source: 'user', name: 'ui' }), 'ui');
  assert.equal(claudeSkillName({ source: 'kit', name: 'deck' }), 'kit:deck');
});

test('preload exposes listSkills on a known channel', () => {
  const { CHANNELS } = require('../src/main/ipc.js');
  assert.equal(CHANNELS.listSkills, 'zonder:listSkills');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload.js'), 'utf8');
  assert.match(src, /listSkills: \(\) => ipcRenderer\.invoke\('zonder:listSkills'\)/);
});
