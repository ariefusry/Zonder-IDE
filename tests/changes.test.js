const test = require('node:test');
const assert = require('node:assert/strict');
const { statusTitle, diffLines, changesTabLabel } = require('../src/renderer/changes.js');

test('statusTitle spells out each change letter, with the old path for a rename', () => {
  assert.equal(statusTitle({ path: 'a.js', status: 'M' }), 'Diubah');
  assert.equal(statusTitle({ path: 'a.js', status: 'A' }), 'Baru');
  assert.equal(statusTitle({ path: 'a.js', status: 'D' }), 'Dihapus');
  assert.equal(statusTitle({ path: 'b c.js', status: 'R', oldPath: 'lama/a.js' }), 'Dipindah dari lama/a.js');
});

test('diffLines tells headers, hunks, added, removed and context lines apart', () => {
  const text = [
    'diff --git a/a.js b/a.js',
    'index 1234..5678 100644',
    '--- a/a.js',
    '+++ b/a.js',
    '@@ -1,3 +1,3 @@',
    ' konteks',
    '-baris lama',
    '--- komentar lama',
    '+baris baru',
    '+++ tanda tambah',
    '\\ No newline at end of file',
    'diff --git a/b.js b/b.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/b.js',
    '',
  ].join('\n');
  assert.deepEqual(diffLines(text).map((l) => l.kind), ['meta', 'meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'del', 'add', 'add', 'meta', 'meta', 'meta', 'meta', 'meta']);
  assert.equal(diffLines(text)[7].text, '--- komentar lama');
  assert.deepEqual(diffLines(''), []);
});

test('changesTabLabel hides the count until the first listChanges', () => {
  assert.equal(changesTabLabel(undefined), 'Perubahan');
  assert.equal(changesTabLabel({ loading: true, files: null }), 'Perubahan');
  assert.equal(changesTabLabel({ loading: false, files: [] }), 'Perubahan (0)');
  assert.equal(changesTabLabel({ loading: true, files: [{}, {}, {}] }), 'Perubahan (3)');
});
