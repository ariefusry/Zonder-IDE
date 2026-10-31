const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowOptions } = require('../src/main/main.js');

test('renderer runs isolated: contextIsolation on, nodeIntegration off, sandbox on', () => {
  const { webPreferences } = createWindowOptions();
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.sandbox, true);
});

test('window keeps the native Windows titlebar', () => {
  assert.notEqual(createWindowOptions().frame, false);
});
