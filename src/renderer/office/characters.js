// Avatar state: which zone and seat each agent belongs in, and walking there.
// Adapted from pixel-agent-desk src/office/office-character.js (MIT License,
// Copyright (c) 2025 geunilbae; notice in pathfinder.js): seat assignment on a zone
// change and step-wise path movement. Sprites, bubbles and effects are not ported.

const OfficeCharacters = ((map, pathfinder) => {
  // Tiles per second.
  const SPEED = 3;

  function takenSeats(chars) {
    return new Set([...chars.values()].map((c) => c.seat).filter(Boolean));
  }

  // Walk from where the avatar stands now. Between two tiles it first finishes the
  // tile it is closest to, so it never cuts across a furniture corner.
  function route(ch) {
    const here = { gx: Math.round(ch.x), gy: Math.round(ch.y) };
    const path = pathfinder.findPath(map.GRID, here, ch.spot) || [];
    if (here.gx !== ch.x || here.gy !== ch.y) path.unshift(here);
    ch.path = path;
  }

  function place(ch, chars, zone) {
    ch.zone = zone;
    ch.seat = map.assignSeat(zone, takenSeats(chars));
    ch.spot = ch.seat ? map.seatById(ch.seat) : map.ZONES[zone].overflow;
    route(ch);
  }

  // Bring avatars in line with the agent list. Status alone decides the zone.
  function sync(chars, agents) {
    const zones = new Map();
    for (const a of agents) {
      const zone = map.STATUS_TO_ZONE[a.status] ?? null;
      if (zone) zones.set(a.id, zone);
    }
    // Leavers go first, so their seats are free for this round.
    for (const id of [...chars.keys()]) if (!zones.has(id)) chars.delete(id);

    for (const a of agents) {
      const zone = zones.get(a.id);
      if (!zone) continue;
      let ch = chars.get(a.id);
      if (!ch) {
        ch = { id: a.id, x: map.DOOR.gx, y: map.DOOR.gy, path: [], zone: null, seat: null, spot: null };
        chars.set(a.id, ch);
      }
      ch.name = a.name;
      ch.status = a.status;
      if (ch.zone !== zone) {
        ch.seat = null;
        place(ch, chars, zone);
      } else if (!ch.seat && map.assignSeat(zone, takenSeats(chars))) {
        place(ch, chars, zone);
      }
    }
  }

  function step(ch, dt) {
    let move = SPEED * dt;
    while (move > 0 && ch.path.length) {
      const t = ch.path[0];
      const dx = t.gx - ch.x;
      const dy = t.gy - ch.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= move) {
        ch.x = t.gx;
        ch.y = t.gy;
        ch.path.shift();
        move -= dist;
      } else {
        ch.x += (dx / dist) * move;
        ch.y += (dy / dist) * move;
        move = 0;
      }
    }
  }

  // Extra marks beyond the status colour. Error gets a red flag at the desk, so it
  // reads differently from working even though both sit at a desk.
  function avatarLook(status) {
    return { flag: status === 'error' ? 'error' : null };
  }

  return { SPEED, sync, step, avatarLook };
})(
  typeof module !== 'undefined' ? require('./map.js') : OfficeMap,
  typeof module !== 'undefined' ? require('./pathfinder.js') : OfficePathfinder,
);

if (typeof module !== 'undefined') module.exports = OfficeCharacters;
