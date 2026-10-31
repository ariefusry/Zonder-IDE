// The office floor plan: one room, a zone per status (spec §7), explicit seat IDs.
// Furniture footprints are the only blocked tiles, so GRID is derived from them.

const OfficeMap = (() => {
  const WIDTH = 16;
  const HEIGHT = 12;
  // New avatars walk in from here.
  const DOOR = { gx: 7, gy: 11 };

  // h is the furniture height in tiles.
  const FURNITURE = [
    { zone: 'desk', gx: 1, gy: 2, w: 4, d: 1, h: 0.6 },
    { zone: 'desk', gx: 1, gy: 5, w: 4, d: 1, h: 0.6 },
    { zone: 'whiteboard', gx: 7, gy: 0, w: 3, d: 1, h: 1.8 },
    { zone: 'qa', gx: 12, gy: 0, w: 3, d: 1, h: 0.8 },
    { zone: 'meeting', gx: 11, gy: 4, w: 2, d: 2, h: 0.6 },
    { zone: 'lounge', gx: 1, gy: 9, w: 3, d: 1, h: 0.5 },
    { zone: 'coffee', gx: 11, gy: 9, w: 3, d: 1, h: 0.9 },
  ];

  const row = (prefix, gx, gy, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, gx: gx + i, gy }));

  // overflow: where agents stand when every seat in the zone is taken.
  const ZONES = {
    desk: { name: 'Meja', seats: [...row('desk.A', 1, 3, 4), ...row('desk.B', 1, 6, 4)], overflow: { gx: 5, gy: 4 } },
    whiteboard: { name: 'Papan tulis', seats: row('whiteboard.', 7, 1, 3), overflow: { gx: 8, gy: 2 } },
    qa: { name: 'QA', seats: row('qa.', 12, 1, 3), overflow: { gx: 13, gy: 2 } },
    meeting: {
      name: 'Meeting',
      seats: [
        { id: 'meeting.1', gx: 10, gy: 4 }, { id: 'meeting.2', gx: 10, gy: 5 },
        { id: 'meeting.3', gx: 13, gy: 4 }, { id: 'meeting.4', gx: 13, gy: 5 },
      ],
      overflow: { gx: 11, gy: 6 },
    },
    lounge: { name: 'Lounge', seats: row('lounge.', 1, 10, 3), overflow: { gx: 4, gy: 10 } },
    coffee: { name: 'Kopi', seats: row('coffee.', 11, 10, 3), overflow: { gx: 10, gy: 10 } },
  };

  const STATUS_TO_ZONE = {
    working: 'desk',
    thinking: 'whiteboard',
    approval: 'meeting',
    testing: 'qa',
    done: 'lounge',
    idle: 'coffee',
    error: 'desk',
    starting: 'coffee',
    stopped: null,
  };

  // GRID[gy][gx] is true where an avatar may walk.
  const GRID = Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(true));
  for (const f of FURNITURE) {
    for (let y = f.gy; y < f.gy + f.d; y++) for (let x = f.gx; x < f.gx + f.w; x++) GRID[y][x] = false;
  }

  const SEATS = new Map(Object.values(ZONES).flatMap((z) => z.seats).map((s) => [s.id, s]));

  function seatById(id) {
    return SEATS.get(id) || null;
  }

  // First free seat in the zone, or null when the zone is full or unknown.
  function assignSeat(zone, takenSeatIds) {
    const z = ZONES[zone];
    if (!z) return null;
    const taken = new Set(takenSeatIds);
    const seat = z.seats.find((s) => !taken.has(s.id));
    return seat ? seat.id : null;
  }

  return { WIDTH, HEIGHT, DOOR, FURNITURE, ZONES, STATUS_TO_ZONE, GRID, seatById, assignSeat };
})();

if (typeof module !== 'undefined') module.exports = OfficeMap;
