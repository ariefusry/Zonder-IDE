const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRoles, snapshot, policyForResume, WRITE, SHELL } = require('../src/main/roles.js');
const { PERSONAS } = require('../src/main/personas.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-roles-'));
const file = (dir) => path.join(dir, 'roles.json');
const designer = { name: 'Designer', persona: 'Kamu Designer.', write: 'ask', shell: 'ask', skills: [], disableSkills: false };

test('enums', () => {
  assert.deepEqual(WRITE, ['deny', 'tests', 'ask', 'allow']);
  assert.deepEqual(SHELL, ['deny', 'ask', 'auto']);
});

test('list() on an empty dir returns the six built-ins in table order with the PERSONAS text', () => {
  const roles = createRoles({ dir: tmp() }).list();
  assert.deepEqual(roles.map((r) => [r.name, r.write, r.shell, r.builtin]), [
    ['Senior Developer', 'allow', 'auto', true],
    ['Junior Developer', 'ask', 'ask', true],
    ['Reviewer', 'deny', 'deny', true],
    ['QA Engineer', 'tests', 'auto', true],
    ['Researcher', 'deny', 'deny', true],
    ['Custom', 'ask', 'ask', true],
  ]);
  for (const r of roles) {
    assert.equal(r.persona, PERSONAS[r.name]);
    assert.deepEqual(r.skills, []);
    assert.equal(r.disableSkills, false);
  }
});

test('save() adds a custom role "Designer" and a new createRoles on the same dir returns it', () => {
  const dir = tmp();
  const saved = createRoles({ dir }).save(designer);
  assert.equal(saved.builtin, false);
  const again = createRoles({ dir });
  assert.deepEqual(again.get('Designer'), saved);
  assert.equal(again.list().at(-1).name, 'Designer');
});

test('save() edits a built-in persona; reset() restores PERSONAS text and table permissions', () => {
  const dir = tmp();
  const roles = createRoles({ dir });
  roles.save({ ...roles.get('Junior Developer'), persona: 'Junior baru.', write: 'deny' });
  assert.equal(createRoles({ dir }).get('Junior Developer').persona, 'Junior baru.');
  const back = roles.reset('Junior Developer');
  assert.equal(back.persona, PERSONAS['Junior Developer']);
  assert.equal(back.write, 'ask');
  assert.equal(createRoles({ dir }).get('Junior Developer').write, 'ask');
});

test('remove() deletes a custom role; built-ins refuse; reset refuses custom roles', () => {
  const dir = tmp();
  const roles = createRoles({ dir });
  roles.save(designer);
  assert.throws(() => roles.remove('Reviewer'), /Peran bawaan tidak bisa dihapus\./);
  assert.throws(() => roles.reset('Designer'), /bukan peran bawaan/);
  roles.remove('Designer');
  assert.equal(createRoles({ dir }).get('Designer'), null);
  assert.throws(() => roles.remove('Tidak Ada'), /Peran tidak dikenal/);
});

test('save() rejects bad names and leaves the file unchanged', () => {
  const dir = tmp();
  const roles = createRoles({ dir });
  roles.save(designer);
  const before = fs.readFileSync(file(dir), 'utf8');
  for (const name of ['', '   ', 'reviewer', 'x'.repeat(41), 5]) {
    assert.throws(() => roles.save({ ...designer, name }), Error, JSON.stringify(name));
  }
  assert.throws(() => roles.save({ ...designer, name: 'designer', isNew: true }), /sudah ada/);
  assert.equal(fs.readFileSync(file(dir), 'utf8'), before);
});

test('save() rejects unknown permission values, bad personas, and bad skill lists', () => {
  const roles = createRoles({ dir: tmp() });
  assert.throws(() => roles.save({ ...designer, write: 'everything' }), /Izin tulis/);
  assert.throws(() => roles.save({ ...designer, shell: 'yes' }), /Izin shell/);
  assert.throws(() => roles.save({ ...designer, persona: 5 }), /Persona/);
  assert.throws(() => roles.save({ ...designer, persona: 'x'.repeat(20001) }), /Persona/);
  assert.throws(() => roles.save({ ...designer, skills: 'ui' }), /Skill/);
});

test('corrupt roles.json gives the built-ins, and the next save writes valid JSON', () => {
  const dir = tmp();
  fs.writeFileSync(file(dir), '{not json');
  const roles = createRoles({ dir });
  assert.equal(roles.list().length, 6);
  roles.save(designer);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file(dir), 'utf8')));
  assert.equal(createRoles({ dir }).get('Designer').name, 'Designer');
});

test('without a dir the store works in memory', () => {
  const roles = createRoles();
  roles.save(designer);
  assert.equal(roles.get('Designer').write, 'ask');
});

test('snapshot keeps only what decide and the agent need', () => {
  const roles = createRoles();
  assert.deepEqual(snapshot(roles.get('QA Engineer')), { name: 'QA Engineer', write: 'tests', shell: 'auto', skills: [], disableSkills: false });
});

test('policyForResume: current role, deleted custom role, and an old record without a policy', () => {
  const roles = createRoles();
  const saved = roles.save(designer);
  const rec = { role: 'Designer', rolePolicy: snapshot(saved) };
  roles.save({ ...designer, write: 'deny' });
  assert.deepEqual(policyForResume(rec, roles), { rolePolicy: { ...snapshot(saved), write: 'deny' }, roleDeleted: false });
  roles.remove('Designer');
  assert.deepEqual(policyForResume(rec, roles), { rolePolicy: rec.rolePolicy, roleDeleted: true });
  assert.deepEqual(policyForResume({ role: 'Junior Developer' }, roles), { rolePolicy: snapshot(roles.get('Junior Developer')), roleDeleted: false });
  assert.equal(policyForResume({ role: 'Hilang' }, roles).roleDeleted, true);
});
