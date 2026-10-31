const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Persistence } = require('../src/main/persistence.js');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zonder-persist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const rec = (id, extra = {}) => ({ id, name: `Agent ${id}`, role: 'Senior Developer', status: 'stopped', sessionId: 's-1', createdAt: 1, ...extra });

test('agents round-trip through agents.json', (t) => {
  const dir = tempDir(t);
  new Persistence(dir).saveAgents([rec('a1'), rec('b2', { name: 'Nadia "N" ünï' })]);
  assert.ok(fs.existsSync(path.join(dir, 'agents.json')));
  assert.deepEqual(new Persistence(dir).loadAgents(), [rec('a1'), rec('b2', { name: 'Nadia "N" ünï' })]);
});

test('loadAgents with no file returns an empty list', (t) => {
  assert.deepEqual(new Persistence(tempDir(t)).loadAgents(), []);
});

test('two quick saveAgents calls leave valid JSON with the last value and no temp files', (t) => {
  const dir = tempDir(t);
  const p = new Persistence(dir);
  p.saveAgents([rec('a1')]);
  p.saveAgents([rec('a1'), rec('b2')]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8')).map((r) => r.id), ['a1', 'b2']);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f !== 'agents.json' && f !== 'history'), []);
});

test('a corrupt agents.json is set aside, not overwritten silently', (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'agents.json'), '[{"id": "a1"');
  assert.deepEqual(new Persistence(dir).loadAgents(), []);
  const kept = fs.readdirSync(dir).filter((f) => f.startsWith('agents.json.corrupt-'));
  assert.equal(kept.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, kept[0]), 'utf8'), '[{"id": "a1"');
});

test('appended events come back in order', (t) => {
  const p = new Persistence(tempDir(t));
  p.appendEvent('a1', { agentId: 'a1', ts: 1, type: 'message', role: 'user', text: 'halo\nbaris dua' });
  p.appendEvent('a1', { agentId: 'a1', ts: 2, type: 'status', from: 'idle', to: 'thinking' });
  p.appendEvent('b2', { agentId: 'b2', ts: 3, type: 'message', role: 'agent', text: 'lain' });
  p.appendEvent('a1', { agentId: 'a1', ts: 4, type: 'message', role: 'agent', text: 'ok' });
  assert.deepEqual(p.loadHistory('a1').map((e) => e.ts), [1, 2, 4]);
  assert.equal(p.loadHistory('a1')[0].text, 'halo\nbaris dua');
  assert.deepEqual(p.loadHistory('b2').map((e) => e.ts), [3]);
});

test('history for an unknown agent is empty', (t) => {
  assert.deepEqual(new Persistence(tempDir(t)).loadHistory('nobody'), []);
});

test('a truncated last JSONL line is skipped, not fatal', (t) => {
  const dir = tempDir(t);
  const p = new Persistence(dir);
  p.appendEvent('a1', { agentId: 'a1', ts: 1, type: 'message', text: 'ok' });
  fs.appendFileSync(path.join(dir, 'history', 'a1.jsonl'), '{"agentId":"a1","ts":2,"type":"mess');
  assert.deepEqual(p.loadHistory('a1').map((e) => e.ts), [1]);
  // Writing after a crash still yields readable lines.
  p.appendEvent('a1', { agentId: 'a1', ts: 3, type: 'message', text: 'after' });
  assert.deepEqual(p.loadHistory('a1').map((e) => e.ts), [1, 3]);
});

test('agent ids that could escape the history dir are rejected', (t) => {
  const p = new Persistence(tempDir(t));
  for (const bad of ['../x', '..\\x', 'a/b', '', 'C:x']) {
    assert.throws(() => p.appendEvent(bad, { type: 'message' }), /agent id/, bad);
    assert.throws(() => p.loadHistory(bad), /agent id/, bad);
  }
});
