const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettings, DEFAULTS } = require('../src/main/settings.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-set-'));

test('get() on an empty dir returns the defaults', () => {
  const dir = tmp();
  try {
    const s = createSettings({ dir });
    assert.deepEqual(s.get(), {
      workspace: { defaultRepo: null, baseBranch: 'main', stopCleanup: null },
      agent: { claude: { model: 'claude-sonnet-5-5', effort: null }, router: { model: null, effort: null }, maxToolRounds: 25, commandTimeoutSec: 60 },
      notify: { approval: true, done: true, error: true },
    });
    assert.deepEqual(s.get(), DEFAULTS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('maxToolRounds 0 and 101 throw; 40 persists across createSettings', () => {
  const dir = tmp();
  try {
    const s = createSettings({ dir });
    assert.throws(() => s.update({ agent: { maxToolRounds: 0 } }), /1 sampai 100/);
    assert.throws(() => s.update({ agent: { maxToolRounds: 101 } }), /1 sampai 100/);
    assert.throws(() => s.update({ agent: { maxToolRounds: 2.5 } }), /1 sampai 100/);
    assert.equal(s.update({ agent: { maxToolRounds: 40 } }).agent.maxToolRounds, 40);
    const again = createSettings({ dir }).get();
    assert.equal(again.agent.maxToolRounds, 40);
    assert.equal(again.agent.commandTimeoutSec, 60, 'deep merge keeps the siblings');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('commandTimeoutSec outside 5..600 throws', () => {
  const s = createSettings();
  assert.throws(() => s.update({ agent: { commandTimeoutSec: 4 } }), /5 sampai 600/);
  assert.throws(() => s.update({ agent: { commandTimeoutSec: 601 } }), /5 sampai 600/);
  assert.equal(s.update({ agent: { commandTimeoutSec: 5 } }).agent.commandTimeoutSec, 5);
});

test('stopCleanup nuke throws; the three choices and null are accepted', () => {
  const s = createSettings();
  assert.throws(() => s.update({ workspace: { stopCleanup: 'nuke' } }), /Pilihan berhenti/);
  for (const v of ['keep', 'worktree', 'worktree+branch', null]) assert.equal(s.update({ workspace: { stopCleanup: v } }).workspace.stopCleanup, v);
});

test('bad values and unknown keys throw and change nothing', () => {
  const s = createSettings();
  assert.throws(() => s.update({ workspace: { baseBranch: '' } }), /Branch dasar/);
  assert.throws(() => s.update({ notify: { done: 'ya' } }), /Notifikasi/);
  assert.throws(() => s.update({ theme: 'light' }), /tidak dikenal/);
  assert.throws(() => s.update({ agent: { maxToolRounds: 30, extra: 1 } }), /tidak dikenal/);
  assert.throws(() => s.update(null), /tidak valid/);
  assert.deepEqual(s.get(), DEFAULTS);
});

test('get() returns a copy', () => {
  const s = createSettings();
  s.get().agent.maxToolRounds = 99;
  assert.equal(s.get().agent.maxToolRounds, 25);
});

test('corrupt settings.json -> defaults; next update rewrites it', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ rusak');
    const s = createSettings({ dir });
    assert.deepEqual(s.get(), DEFAULTS);
    s.update({ notify: { done: false } });
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(raw.notify.done, false);
    assert.equal(raw.agent.maxToolRounds, 25);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a stored file with one bad field keeps the good fields and defaults the bad one', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ agent: { maxToolRounds: 500, commandTimeoutSec: 30 }, notify: { done: false } }));
    const got = createSettings({ dir }).get();
    assert.equal(got.agent.maxToolRounds, 25);
    assert.equal(got.agent.commandTimeoutSec, 30);
    assert.equal(got.notify.done, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agent defaults: claude model must be a claude id, efforts must be in their kind list', () => {
  const s = createSettings();
  assert.equal(s.update({ agent: { claude: { model: 'claude-opus-5-5', effort: 'xhigh' } } }).agent.claude.effort, 'xhigh');
  assert.equal(s.update({ agent: { router: { model: 'daily-coding', effort: 'low' } } }).agent.router.model, 'daily-coding');
  assert.throws(() => s.update({ agent: { claude: { model: 'gpt-5' } } }), /Model Claude/);
  assert.throws(() => s.update({ agent: { claude: { effort: 'ultra' } } }), /Effort/);
  assert.throws(() => s.update({ agent: { router: { effort: 'xhigh' } } }), /Effort/);
  assert.equal(s.update({ agent: { claude: { effort: null }, router: { effort: null } } }).agent.claude.effort, null);
});

test('a stored or sent alias (opus, sonnet, haiku) becomes its versioned id', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ agent: { claude: { model: 'sonnet' } } }));
    assert.equal(createSettings({ dir }).get().agent.claude.model, 'claude-sonnet-5-5');
    assert.equal(createSettings({ dir }).update({ agent: { claude: { model: 'opus' } } }).agent.claude.model, 'claude-opus-5-5');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
