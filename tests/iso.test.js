const test = require('node:test');
const assert = require('node:assert/strict');
const { project, unproject, depthKey } = require('../src/renderer/office/iso.js');

test('unproject inverts project at floor level', () => {
  for (const [gx, gy] of [[0, 0], [3, 7], [15, 11], [2.5, 0.25], [-1, 4]]) {
    const p = project(gx, gy);
    const back = unproject(p.x, p.y);
    assert.ok(Math.abs(back.gx - gx) < 1e-9, `gx ${gx} -> ${back.gx}`);
    assert.ok(Math.abs(back.gy - gy) < 1e-9, `gy ${gy} -> ${back.gy}`);
  }
});

test('height lifts a point straight up the screen', () => {
  const floor = project(4, 2);
  const lifted = project(4, 2, 1);
  assert.equal(lifted.x, floor.x);
  assert.ok(lifted.y < floor.y);
});

test('a tile nearer the viewer projects lower on screen', () => {
  assert.ok(project(5, 5).y > project(4, 5).y);
  assert.ok(project(5, 5).y > project(5, 4).y);
});

test('sprites with a larger foot Y sort later', () => {
  const sprites = [
    { id: 'front', foot: project(6, 6).y },
    { id: 'back', foot: project(1, 1).y },
    { id: 'mid', foot: project(3, 4).y },
  ];
  const order = sprites.slice().sort((a, b) => depthKey(a.foot) - depthKey(b.foot)).map((s) => s.id);
  assert.deepEqual(order, ['back', 'mid', 'front']);
});
