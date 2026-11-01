const test = require('node:test');
const assert = require('node:assert/strict');
const { POSES, poseFor, appearanceFor, phase } = require('../src/renderer/office/look.js');

const seated = { walking: false, seated: true };

test('poseFor maps each status to the pose and mark in the table above', () => {
  const table = {
    working: ['type', null],
    thinking: ['board', 'dots'],
    idle: ['sip', null],
    starting: ['sip', null],
    approval: ['raise', 'alert'],
    testing: ['qa', null],
    done: ['lounge', 'check'],
    error: ['facepalm', 'error'],
  };
  for (const [status, [pose, mark]] of Object.entries(table)) {
    const r = poseFor(status, seated);
    assert.deepEqual([r.pose, r.mark], [pose, mark], status);
    assert.ok(POSES.includes(r.pose));
  }
  assert.deepEqual(POSES, ['type', 'board', 'sip', 'raise', 'qa', 'lounge', 'facepalm', 'walk']);
});

test('poseFor(\'testing\', …).mark is null', () => {
  assert.equal(poseFor('testing', seated).mark, null);
  assert.equal(poseFor('testing', { walking: false, seated: false }).mark, null);
});

test('poseFor(\'approval\', …).mark is \'alert\' and differs from poseFor(\'error\', …).mark', () => {
  assert.equal(poseFor('approval', seated).mark, 'alert');
  assert.notEqual(poseFor('approval', seated).mark, poseFor('error', seated).mark);
});

test('poseFor(any, {walking:true}).pose is \'walk\'; mark unchanged', () => {
  for (const status of ['working', 'thinking', 'idle', 'approval', 'testing', 'done', 'error']) {
    const walking = poseFor(status, { walking: true, seated: true });
    assert.equal(walking.pose, 'walk', status);
    assert.equal(walking.standing, true, status);
    assert.equal(walking.mark, poseFor(status, seated).mark, status);
  }
});

test('poseFor(\'working\', {seated:false}).standing is true', () => {
  for (const status of ['working', 'thinking', 'idle', 'approval', 'testing', 'done', 'error']) {
    assert.equal(poseFor(status, { walking: false, seated: false }).standing, true, status);
  }
  // Seated poses sit; the others stand even with a seat.
  assert.equal(poseFor('working', seated).standing, false);
  assert.equal(poseFor('testing', seated).standing, false);
  assert.equal(poseFor('done', seated).standing, false);
  assert.equal(poseFor('error', seated).standing, false);
  assert.equal(poseFor('thinking', seated).standing, true);
  assert.equal(poseFor('approval', seated).standing, true);
  assert.equal(poseFor('idle', seated).standing, true);
});

test('appearanceFor is stable for the same id and differs for at least 4 of 6 sample ids', () => {
  const ids = ['a1b2c3d4e5f6', '0f1e2d3c4b5a', 'agent01', 'agent02', 'zz9900aa11bb', 'raka-42'];
  for (const id of ids) assert.deepEqual(appearanceFor(id), appearanceFor(id));
  const looks = new Set(ids.map((id) => JSON.stringify(appearanceFor(id))));
  assert.ok(looks.size >= 4, `only ${looks.size} distinct looks`);
  for (const id of ids) {
    const a = appearanceFor(id);
    assert.ok([0, 1, 2].includes(a.hairStyle));
    assert.match(a.hair, /^--office-hair-[1-9]$/);
  }
  assert.ok(new Set(Array.from({ length: 60 }, (_, i) => appearanceFor(`id${i}`).hair)).size >= 5, 'at least 5 hair tones in use');
});

test('drawOrder: wide furniture hides an avatar behind it, never one seated in front', () => {
  const { drawOrder } = require('../src/renderer/office/iso.js');
  const at = (id, gx, gy, r = 0.2) => ({ id, x0: gx - r, x1: gx + r, y0: gy - r, y1: gy + r });
  const sofa = { id: 'sofa', x0: 1, x1: 4, y0: 9, y1: 10 };
  const behind = at('behind', 3.5, 8.5);
  const seated = at('seated', 1.5, 10.5);
  const right = at('right', 4.5, 9.5);
  const order = drawOrder([right, seated, sofa, behind]).map((it) => it.id);
  assert.ok(order.indexOf('behind') < order.indexOf('sofa'), order.join());
  assert.ok(order.indexOf('sofa') < order.indexOf('seated'), order.join());
  assert.ok(order.indexOf('sofa') < order.indexOf('right'), order.join());

  // Overlapping footprints (an avatar on its chair) fall back to depth, then bias.
  const chair = at('chair', 2.5, 3.5, 0.25);
  const sitter = { ...at('sitter', 2.5, 3.5), bias: 0.01 };
  assert.deepEqual(drawOrder([sitter, chair]).map((it) => it.id), ['chair', 'sitter']);
  assert.deepEqual(drawOrder([]), []);
});

test('phase(0,1000)=0, phase(250,1000)=0.25, phase(1250,1000)=0.25, phase(0,1000,0.5)=0.5', () => {
  assert.equal(phase(0, 1000), 0);
  assert.equal(phase(250, 1000), 0.25);
  assert.equal(phase(1250, 1000), 0.25);
  assert.equal(phase(0, 1000, 0.5), 0.5);
  assert.equal(phase(0, 1000, 1.25), 0.25);
  assert.ok(phase(-250, 1000) >= 0 && phase(-250, 1000) < 1);
});
