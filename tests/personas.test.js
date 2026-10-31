const test = require('node:test');
const assert = require('node:assert/strict');
const { PERSONAS } = require('../src/main/personas.js');
const { ROLES } = require('../src/main/policy/decide.js');

test('every role has a default prompt; Custom starts empty', () => {
  assert.deepEqual(Object.keys(PERSONAS), ROLES);
  for (const role of ROLES.filter((r) => r !== 'Custom')) assert.ok(PERSONAS[role].length > 40, role);
  assert.equal(PERSONAS.Custom, '');
});

test('read-only roles are told they cannot write or run commands', () => {
  for (const role of ['Reviewer', 'Researcher']) assert.match(PERSONAS[role], /tidak (bisa|dapat) menulis|hanya membaca/i, role);
});
