const test = require('node:test');
const assert = require('node:assert/strict');
const { modelFamily, logoFor, modelLine } = require('../src/renderer/models.js');

test('modelFamily maps router and Claude ids to a family by prefix after the last slash', () => {
  for (const id of ['kr/claude-sonnet-4.5', 'ag/claude-opus-4-6-thinking', 'sonnet']) assert.equal(modelFamily(id), 'claude', id);
  for (const id of ['cx/gpt-6-luna', 'o3-mini']) assert.equal(modelFamily(id), 'openai', id);
  for (const id of ['ag/gemini-3.8-flash', 'gemini/gemini-3.6-flash']) assert.equal(modelFamily(id), 'gemini', id);
  assert.equal(modelFamily('oc/deepseek-v4.1-flash-free'), 'deepseek');
  for (const id of ['daily-coding', '', null]) assert.equal(modelFamily(id), null, String(id));
});

test('logoFor a Claude agent is the Claude logo', () => {
  assert.deepEqual(logoFor({ kind: 'claude', model: 'sonnet' }), { kind: 'logo', family: 'claude', label: 'Claude' });
});

test('logoFor a router combo is the combo glyph until the served model is known', () => {
  assert.deepEqual(logoFor({ kind: 'router', model: 'daily-coding' }), { kind: 'combo', label: 'Combo' });
  assert.deepEqual(logoFor({ kind: 'router', model: 'daily-coding', servedModel: 'kr/claude-sonnet-4.5' }), { kind: 'logo', family: 'claude', label: 'Claude' });
});

test('logoFor: servedModel equal to the combo stays combo; unknown models get their initial', () => {
  assert.deepEqual(logoFor({ kind: 'router', model: 'daily-coding', servedModel: 'daily-coding' }), { kind: 'combo', label: 'Combo' });
  assert.deepEqual(logoFor({ kind: 'router', model: 'daily-coding', servedModel: 'xx/mystery-1' }), { kind: 'initial', letter: 'M', label: 'xx/mystery-1' });
  assert.deepEqual(logoFor({ kind: 'router', model: 'xx/mystery-1' }), { kind: 'initial', letter: 'M', label: 'xx/mystery-1' });
});

test('modelLine names the served model next to the combo', () => {
  assert.equal(modelLine({ kind: 'router', model: 'daily-coding', servedModel: 'kr/claude-sonnet-4.5' }), 'daily-coding · claude-sonnet-4.5');
  assert.equal(modelLine({ kind: 'router', model: 'daily-coding' }), 'daily-coding');
  assert.equal(modelLine({ kind: 'router', model: 'm1', servedModel: 'm1' }), 'm1');
});
