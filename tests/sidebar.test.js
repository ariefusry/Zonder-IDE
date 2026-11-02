const test = require('node:test');
const assert = require('node:assert/strict');
const { groupAgents } = require('../src/renderer/sidebar.js');

const ag = (id, workspace, createdAt, extra = {}) => ({ id, workspace, createdAt, status: 'idle', ...extra });

test('two agents in D:\\a\\Repo and one in D:\\b\\Other -> two groups named Repo and Other; group with the newest createdAt first', () => {
  const groups = groupAgents([ag('1', 'D:\\a\\Repo', 10), ag('2', 'D:\\b\\Other', 20), ag('3', 'D:\\a\\Repo', 30)]);
  assert.deepEqual(groups.map((g) => [g.key, g.name, g.path, g.agents.map((a) => a.id)]), [
    ['d:\\a\\repo', 'Repo', 'D:\\a\\Repo', ['1', '3']],
    ['d:\\b\\other', 'Other', 'D:\\b\\Other', ['2']],
  ]);
});

test('D:\\a\\Repo and d:\\A\\repo are one group', () => {
  const groups = groupAgents([ag('1', 'D:\\a\\Repo', 1), ag('2', 'd:\\A\\repo', 2)]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].agents.map((a) => a.id), ['1', '2']);
});

test('sample agents -> group "Contoh"', () => {
  const groups = groupAgents([ag('1', 'D:\\x', 1, { sample: true }), ag('2', null, 2, { sample: true })]);
  assert.deepEqual(groups.map((g) => [g.key, g.name, g.path, g.agents.length]), [['sample', 'Contoh', null, 2]]);
});

test('approvals counts agents with status approval', () => {
  const groups = groupAgents([ag('1', 'D:\\a\\Repo', 1, { status: 'approval' }), ag('2', 'D:\\a\\Repo', 2), ag('3', 'D:\\a\\Repo', 3, { status: 'approval' })]);
  assert.equal(groups[0].approvals, 2);
});

test('a trailing separator or forward slashes still name the last folder', () => {
  assert.equal(groupAgents([ag('1', 'D:/code/Zonder-app/', 1)])[0].name, 'Zonder-app');
});
