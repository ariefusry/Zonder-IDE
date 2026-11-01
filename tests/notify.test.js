const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentStore } = require('../src/main/store.js');
const { createSettings } = require('../src/main/settings.js');
const { startNotifier } = require('../src/main/notify.js');

function setup({ focused = false } = {}) {
  const store = new AgentStore();
  store.add({ id: 'a1', name: 'Raka', kind: 'claude', status: 'working' });
  store.add({ id: 'r1', name: 'Rara', kind: 'router', status: 'working' });
  store.emit({ agentId: 'a1', type: 'message', role: 'agent', text: 'rahasia isi chat' });
  const shown = [];
  class Notification {
    constructor(opts) {
      this.opts = opts;
    }
    show() {
      shown.push(this.opts);
    }
  }
  const settings = createSettings();
  const stop = startNotifier({ store, settings, Notification, getWindow: () => ({ isFocused: () => focused }) });
  return { store, settings, shown, stop };
}

test('approval, done and error each raise one alert with name and kind, never message text', () => {
  const s = setup();
  s.store.setStatus('a1', 'approval');
  s.store.setStatus('r1', 'done');
  s.store.setStatus('a1', 'error');
  assert.equal(s.shown.length, 3);
  assert.match(s.shown[0].title, /Raka/);
  assert.match(`${s.shown[0].title} ${s.shown[0].body}`, /Claude/);
  assert.match(`${s.shown[1].title} ${s.shown[1].body}`, /Rara/);
  assert.match(`${s.shown[1].title} ${s.shown[1].body}`, /9router/);
  for (const n of s.shown) assert.doesNotMatch(`${n.title} ${n.body}`, /rahasia/);
  s.stop();
});

test('other statuses raise nothing', () => {
  const s = setup();
  for (const st of ['thinking', 'working', 'testing', 'idle', 'stopped']) s.store.setStatus('a1', st);
  assert.equal(s.shown.length, 0);
});

test('notify.done false -> no alert for done; approval still alerts', () => {
  const s = setup();
  s.settings.update({ notify: { done: false } });
  s.store.setStatus('a1', 'done');
  assert.equal(s.shown.length, 0);
  s.store.setStatus('r1', 'approval');
  assert.equal(s.shown.length, 1);
});

test('window focused -> no alert', () => {
  const s = setup({ focused: true });
  s.store.setStatus('a1', 'approval');
  assert.equal(s.shown.length, 0);
});

test('the returned function unsubscribes', () => {
  const s = setup();
  s.stop();
  s.store.setStatus('a1', 'approval');
  assert.equal(s.shown.length, 0);
});
