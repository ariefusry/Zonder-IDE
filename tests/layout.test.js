const test = require('node:test');
const assert = require('node:assert/strict');
const { LAYOUT, clampWidths, parseLayout } = require('../src/renderer/layout.js');

const DEFAULTS = { left: 240, right: 380, officeHidden: false };

test('LAYOUT holds the spec widths', () => {
  assert.deepEqual(LAYOUT, { left: { def: 240, min: 180 }, right: { def: 380, min: 300 }, officeMin: 360 });
});

test('parseLayout(null), parseLayout(\'{\'), parseLayout(\'{"left":"x"}\') -> defaults 240/380/false', () => {
  assert.deepEqual(parseLayout(null), DEFAULTS);
  assert.deepEqual(parseLayout('{'), DEFAULTS);
  assert.deepEqual(parseLayout('{"left":"x"}'), DEFAULTS);
  assert.deepEqual(parseLayout('[1,2]'), DEFAULTS);
  assert.deepEqual(parseLayout('null'), DEFAULTS);
  assert.deepEqual(parseLayout('{"left":260,"right":"9","officeHidden":"ya"}'), { left: 260, right: 380, officeHidden: false });
  assert.deepEqual(parseLayout('{"left":260,"right":420,"officeHidden":true}'), { left: 260, right: 420, officeHidden: true });
  assert.deepEqual(parseLayout('{"left":1e999,"right":-5}'), { left: 240, right: -5, officeHidden: false });
});

test('clampWidths({left:100,right:200}, 1400) -> {left:180,right:300}', () => {
  assert.deepEqual(clampWidths({ left: 100, right: 200 }, 1400), { left: 180, right: 300 });
  assert.deepEqual(clampWidths({ left: 'x', right: null }, 1400), { left: 240, right: 380 });
});

test('clampWidths({left:400,right:700}, 1100) keeps office >= 360: left + right <= 740, right shrinks first', () => {
  const r = clampWidths({ left: 400, right: 700 }, 1100);
  assert.ok(r.left + r.right <= 740);
  assert.deepEqual(r, { left: 400, right: 340 });
  // Right already at its minimum: left gives way next, never below its own.
  assert.deepEqual(clampWidths({ left: 400, right: 300 }, 900), { left: 240, right: 300 });
  assert.deepEqual(clampWidths({ left: 400, right: 700 }, 700), { left: 180, right: 300 });
});

test('clampWidths with officeHidden true allows left + right up to total', () => {
  assert.deepEqual(clampWidths({ left: 400, right: 700, officeHidden: true }, 1100), { left: 400, right: 700 });
  assert.deepEqual(clampWidths({ left: 500, right: 700, officeHidden: true }, 1100), { left: 500, right: 600 });
});
