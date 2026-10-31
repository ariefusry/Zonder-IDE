const test = require('node:test');
const assert = require('node:assert/strict');
const { ZONES, STATUS_TO_ZONE, GRID, DOOR, assignSeat, seatById } = require('../src/renderer/office/map.js');
const { findPath } = require('../src/renderer/office/pathfinder.js');
const { sync, step, avatarLook } = require('../src/renderer/office/characters.js');

const walkable = ({ gx, gy }) => gy >= 0 && gy < GRID.length && gx >= 0 && gx < GRID[0].length && GRID[gy][gx];
const allSeats = () => Object.values(ZONES).flatMap((z) => z.seats);

test('every mapped zone exists; stopped has no zone', () => {
  for (const [status, zone] of Object.entries(STATUS_TO_ZONE)) {
    if (status === 'stopped') assert.equal(zone, null);
    else assert.ok(ZONES[zone], `${status} -> ${zone}`);
  }
  assert.equal(STATUS_TO_ZONE.approval, 'meeting');
  assert.equal(STATUS_TO_ZONE.error, 'desk');
});

test('seat IDs are unique, prefixed with their zone, and walkable', () => {
  const ids = allSeats().map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const [name, zone] of Object.entries(ZONES)) {
    assert.ok(zone.seats.length > 0, name);
    for (const s of zone.seats) {
      assert.ok(s.id.startsWith(`${name}.`), s.id);
      assert.ok(walkable(s), s.id);
      assert.deepEqual(seatById(s.id), s);
    }
  }
  assert.ok(ZONES.desk.seats.some((s) => s.id === 'desk.A1'));
  assert.ok(ZONES.whiteboard.seats.some((s) => s.id === 'whiteboard.1'));
});

test('overflow spots are walkable and not seats', () => {
  const seatTiles = new Set(allSeats().map((s) => `${s.gx},${s.gy}`));
  for (const [name, zone] of Object.entries(ZONES)) {
    assert.ok(walkable(zone.overflow), name);
    assert.ok(!seatTiles.has(`${zone.overflow.gx},${zone.overflow.gy}`), name);
  }
});

test('every seat and overflow spot is reachable from the door', () => {
  assert.ok(walkable(DOOR));
  for (const [name, zone] of Object.entries(ZONES)) {
    for (const spot of [...zone.seats, zone.overflow]) {
      assert.ok(findPath(GRID, DOOR, spot), `${name} ${spot.id || 'overflow'}`);
    }
  }
});

test('findPath steps one tile at a time through walkable tiles only', () => {
  const grid = [
    [true, true, true],
    [false, false, true],
    [true, true, true],
  ];
  const path = findPath(grid, { gx: 0, gy: 0 }, { gx: 0, gy: 2 });
  assert.deepEqual(path, [{ gx: 1, gy: 0 }, { gx: 2, gy: 0 }, { gx: 2, gy: 1 }, { gx: 2, gy: 2 }, { gx: 1, gy: 2 }, { gx: 0, gy: 2 }]);
  assert.deepEqual(findPath(grid, { gx: 0, gy: 0 }, { gx: 0, gy: 0 }), []);
  assert.equal(findPath(grid, { gx: 0, gy: 0 }, { gx: 0, gy: 1 }), null);
  const walled = [[true, false, true]];
  assert.equal(findPath(walled, { gx: 0, gy: 0 }, { gx: 2, gy: 0 }), null);
});

test('assignSeat never double-books and returns null when full', () => {
  const taken = new Set();
  for (let i = 0; i < ZONES.meeting.seats.length; i++) {
    const id = assignSeat('meeting', taken);
    assert.ok(id && !taken.has(id));
    taken.add(id);
  }
  assert.equal(assignSeat('meeting', taken), null);
  assert.equal(assignSeat('nowhere', new Set()), null);
  assert.equal(assignSeat('qa', [ZONES.qa.seats[0].id]), ZONES.qa.seats[1].id);
});

test('error has a red flag that working does not', () => {
  assert.equal(avatarLook('error').flag, 'error');
  assert.equal(avatarLook('working').flag, null);
  assert.notDeepEqual(avatarLook('error'), avatarLook('working'));
});

const agent = (id, status) => ({ id, name: id, status });
const walk = (ch) => { for (let i = 0; i < 400 && ch.path.length; i++) step(ch, 0.05); };

test('sync seats agents in the zone their status maps to', () => {
  const chars = new Map();
  sync(chars, [agent('a', 'working'), agent('b', 'approval'), agent('c', 'idle')]);
  assert.match(chars.get('a').seat, /^desk\./);
  assert.match(chars.get('b').seat, /^meeting\./);
  assert.match(chars.get('c').seat, /^coffee\./);
  for (const ch of chars.values()) {
    walk(ch);
    const seat = seatById(ch.seat);
    assert.deepEqual([ch.x, ch.y], [seat.gx, seat.gy], ch.id);
  }
});

test('two agents in one zone get different seats; the overflow stands at the zone spot', () => {
  const chars = new Map();
  const many = ZONES.meeting.seats.map((_, i) => agent(`m${i}`, 'approval'));
  sync(chars, [...many, agent('extra', 'approval')]);
  const seats = many.map((a) => chars.get(a.id).seat);
  assert.equal(new Set(seats).size, seats.length);
  const extra = chars.get('extra');
  assert.equal(extra.seat, null);
  assert.deepEqual(extra.spot, ZONES.meeting.overflow);
  // A seat frees up: the overflow agent takes it.
  sync(chars, [...many.slice(1), agent('extra', 'approval')]);
  assert.equal(extra.seat, seats[0]);
});

test('a status change walks the agent to the new zone; same zone keeps the seat', () => {
  const chars = new Map();
  sync(chars, [agent('a', 'working')]);
  const ch = chars.get('a');
  walk(ch);
  const desk = ch.seat;
  sync(chars, [agent('a', 'error')]);
  assert.equal(ch.seat, desk);
  assert.equal(ch.path.length, 0);
  sync(chars, [agent('a', 'approval')]);
  assert.match(ch.seat, /^meeting\./);
  assert.ok(ch.path.length > 0);
  // Moving, not teleporting: one short step leaves it between tiles.
  step(ch, 0.1);
  assert.ok(Math.abs(ch.x - seatById(desk).gx) + Math.abs(ch.y - seatById(desk).gy) < 1);
  // Retarget mid-walk: the path starts from where it stands.
  sync(chars, [agent('a', 'done')]);
  assert.match(ch.seat, /^lounge\./);
  walk(ch);
  assert.deepEqual([ch.x, ch.y], [seatById(ch.seat).gx, seatById(ch.seat).gy]);
});

test('every path step goes to a walkable neighbour', () => {
  const chars = new Map();
  sync(chars, [agent('a', 'testing')]);
  const ch = chars.get('a');
  let prev = { gx: ch.x, gy: ch.y };
  for (const t of ch.path) {
    assert.ok(walkable(t));
    assert.equal(Math.abs(t.gx - prev.gx) + Math.abs(t.gy - prev.gy), 1);
    prev = t;
  }
});

test('stopped and removed agents leave the office and free their seat', () => {
  const chars = new Map();
  sync(chars, [agent('a', 'approval'), agent('b', 'approval')]);
  const seatA = chars.get('a').seat;
  sync(chars, [agent('a', 'stopped'), agent('b', 'approval')]);
  assert.equal(chars.has('a'), false);
  sync(chars, [agent('b', 'approval'), agent('c', 'approval')]);
  assert.equal(chars.get('c').seat, seatA);
  sync(chars, []);
  assert.equal(chars.size, 0);
});
