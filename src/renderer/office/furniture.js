// Office room and furniture in a fine-line isometric style (office-life spec §4.3,
// after the prototype in .superpowers/brainstorm/office-isoglow/). Each piece has
// a static `body`, drawn once into a sprite, and an optional `live` part drawn
// every frame. Only equipment an agent is using glows, in that agent's status
// colour; everything else stays neutral grey.

const OfficeFurniture = ((iso) => {
  // Drawing kit bound to one 2D context. `at` maps a grid point to canvas pixels,
  // `s` is the view scale, `C` the resolved --office-* tokens.
  function pen(ctx, at, s, C) {
    function poly(points, fill, stroke = C.line, glow = null) {
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      if (glow) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = 14 * s;
      }
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
    function line(a, b, color = C.detail, width = 1) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    // Iso box with its three visible faces: top, front-left (+gy), front-right (+gx).
    function box(gx, gy, gz, w, d, h, { top = C.deck, side = C.body } = {}) {
      const p = (x, y, z) => at(gx + x, gy + y, gz + z);
      poly([p(0, d, 0), p(w, d, 0), p(w, d, h), p(0, d, h)], side);
      poly([p(w, 0, 0), p(w, d, 0), p(w, d, h), p(w, 0, h)], side);
      poly([p(0, 0, h), p(w, 0, h), p(w, d, h), p(0, d, h)], top);
    }
    // Flat panel facing +gy (a screen, a board), from x0..x1 and z0..z1.
    function faceY(gx, gy, x0, x1, z0, z1, fill, glow = null) {
      poly([at(gx + x0, gy, z0), at(gx + x1, gy, z0), at(gx + x1, gy, z1), at(gx + x0, gy, z1)], fill, glow || C.line, glow);
    }
    // Flat panel facing +gx, from y0..y1 and z0..z1.
    function faceX(gx, gy, y0, y1, z0, z1, fill, stroke = C.line) {
      poly([at(gx, gy + y0, z0), at(gx, gy + y1, z0), at(gx, gy + y1, z1), at(gx, gy + y0, z1)], fill, stroke);
    }
    // Floor-parallel ellipse of radius r tiles around a canvas point.
    function disc(c, r, fill, stroke = C.line) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, (r * iso.TILE_W) / 2 * s, (r * iso.TILE_H) / 2 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    function cup(p, k = 1, stroke = C.line) {
      const u = s * k;
      ctx.beginPath();
      ctx.rect(p.x - 2.5 * u, p.y - 5 * u, 5 * u, 5 * u);
      ctx.fillStyle = C.deck;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    return { ctx, at, s, C, poly, line, box, faceY, faceX, disc, cup };
  }

  function withAlpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // Back walls are this many tiles high; windows sit on them.
  const WALL = 3.2;
  // Wall clock, on the back wall between the whiteboard and the QA station.
  const CLOCK = { gx: 11, gz: 2.6 };

  // Floor slab, two low back walls with windows, faint tile lines, clock face.
  function room(g, W, H) {
    const { at, poly, line, C } = g;
    const slab = -0.5;
    poly([at(0, H, slab), at(W, H, slab), at(W, H, 0), at(0, H, 0)], C.body);
    poly([at(W, 0, slab), at(W, H, slab), at(W, H, 0), at(W, 0, 0)], C.body);
    poly([at(0, 0), at(W, 0), at(W, H), at(0, H)], C.floor);
    for (let x = 2; x < W; x += 2) line(at(x, 0), at(x, H));
    for (let y = 2; y < H; y += 2) line(at(0, y), at(W, y));
    poly([at(0, 0, 0), at(W, 0, 0), at(W, 0, WALL), at(0, 0, WALL)], C.body);
    poly([at(0, 0, 0), at(0, H, 0), at(0, H, WALL), at(0, 0, WALL)], C.body);
    for (const x of [1.6, 3.9]) {
      poly([at(x, 0, 1.4), at(x + 1.8, 0, 1.4), at(x + 1.8, 0, 2.7), at(x, 0, 2.7)], C.glass);
      line(at(x + 0.9, 0, 1.4), at(x + 0.9, 0, 2.7), C.line);
    }
    for (const y of [2, 4.4]) {
      poly([at(0, y, 1.4), at(0, y + 1.8, 1.4), at(0, y + 1.8, 2.7), at(0, y, 2.7)], C.glass);
      line(at(0, y + 0.9, 1.4), at(0, y + 0.9, 2.7), C.line);
    }
    const c = at(CLOCK.gx, 0, CLOCK.gz);
    g.ctx.beginPath();
    g.ctx.ellipse(c.x, c.y, 7 * g.s, 8 * g.s, 0, 0, Math.PI * 2);
    g.ctx.fillStyle = C.glass;
    g.ctx.fill();
    g.ctx.strokeStyle = C.line;
    g.ctx.lineWidth = 1;
    g.ctx.stroke();
  }

  function clockHands(g, now) {
    const c = g.at(CLOCK.gx, 0, CLOCK.gz);
    const m = ((now.getMinutes() + now.getSeconds() / 60) / 60) * Math.PI * 2;
    const h = (((now.getHours() % 12) + now.getMinutes() / 60) / 12) * Math.PI * 2;
    for (const [a, r] of [[h, 4], [m, 6]]) g.line(c, { x: c.x + Math.sin(a) * r * g.s, y: c.y - Math.cos(a) * r * g.s }, g.C.muted);
  }

  // ---- Pieces. Each draw function works in grid units from the piece's origin.

  function deskBody(g, gx, gy, mug) {
    g.box(gx + 0.02, gy + 0.1, 0, 0.96, 0.8, 0.6);
    g.line(g.at(gx + 0.1, gy + 0.9, 0.5), g.at(gx + 0.9, gy + 0.9, 0.5));
    // Keyboard on the sitter's side, behind the desk.
    g.box(gx + 0.3, gy + 0.12, 0.6, 0.4, 0.15, 0.03);
    // Monitor facing the sitter; the viewer sees its back, which is the live part.
    g.box(gx + 0.25, gy + 0.45, 0.6, 0.5, 0.12, 0.55);
    if (mug) g.cup(g.at(gx + 0.85, gy + 0.75, 0.6), 0.6);
  }

  // Back of the monitor. A lit screen shows as a glow around it in the status
  // colour; working flickers, error stays steady.
  function deskScreen(g, gx, gy, status, color, t) {
    const lit = status === 'working' || status === 'error';
    const flicker = status === 'working' ? 0.7 + 0.3 * Math.sin(t / 330) : 1;
    g.faceY(gx + 0.25, gy + 0.57, 0.02, 0.48, 0.62, 1.13, lit ? withAlpha(color, 0.18 * flicker) : g.C.body, lit ? color : null);
  }

  function boardBody(g, gx, gy, w) {
    g.box(gx, gy + 0.1, 0, w, 0.15, 0.1);
    for (const x of [gx + 0.1, gx + w - 0.2]) g.box(x, gy + 0.12, 0, 0.1, 0.1, 1.2);
  }

  function boardFace(g, gx, gy, w, color) {
    const y = gy + 0.25;
    g.faceY(gx, y, 0.05, w - 0.05, 1.0, 2.6, color ? withAlpha(color, 0.1) : g.C.glass, color);
    const ink = color || g.C.detail;
    const at = (x, z) => g.at(gx + x, y, z);
    g.line(at(0.3, 2.3), at(1.2, 2.3), ink);
    g.line(at(0.3, 2.05), at(1.6, 2.05), ink);
    g.line(at(0.3, 1.8), at(0.9, 1.8), ink);
    g.poly([at(1.9, 1.4), at(2.6, 1.4), at(2.6, 2.3), at(1.9, 2.3)], null, ink);
    g.line(at(1.9, 1.85), at(2.6, 1.85), ink);
  }

  function qaBody(g, gx, gy, w) {
    g.box(gx, gy + 0.15, 0, w, 0.8, 0.8);
    for (const x of [gx + 0.4, gx + 1.6]) g.box(x, gy + 0.3, 0.8, 0.9, 0.1, 0.7);
  }

  function qaScreens(g, gx, gy, color, t) {
    const y = gy + 0.4;
    for (const x of [gx + 0.4, gx + 1.6]) g.faceY(x, y, 0.05, 0.85, 0.88, 1.45, color ? withAlpha(color, 0.2) : g.C.glass, color);
    if (!color) return;
    // A running progress bar and a scrolling log; never a pass or fail mark.
    const p = ((t / 1000) * 0.15) % 1;
    g.line(g.at(gx + 0.5, y, 0.97), g.at(gx + 0.5 + 0.7 * p, y, 0.97), color, 2);
    for (let k = 0; k < 4; k++) {
      const z = 1.0 + ((k * 0.12 + (t / 1000) * 0.12) % 0.45);
      g.line(g.at(gx + 1.7, y, z), g.at(gx + 1.95 + (k % 3) * 0.15, y, z), color);
    }
  }

  function meetingBody(g, cx, cy) {
    g.box(cx - 0.15, cy - 0.15, 0, 0.3, 0.3, 0.6);
    const top = g.at(cx, cy, 0.6);
    g.disc(top, 0.95, g.C.deck);
    g.line(top, g.at(cx, cy, 1.15), g.C.line);
  }

  // Signal lamp on the meeting table: pulses while someone waits for approval.
  function meetingLamp(g, cx, cy, color, t) {
    const lamp = g.at(cx, cy, 1.15);
    const { ctx, s } = g;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 3.5 * s, 0, Math.PI * 2);
    if (color) {
      ctx.shadowColor = color;
      ctx.shadowBlur = (10 + 8 * Math.sin(t / 250)) * s;
    }
    ctx.fillStyle = color || g.C.body;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = g.C.line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function sofaBody(g, gx, gy, w) {
    g.box(gx, gy - 0.15, 0, w, 0.25, 0.85);
    g.box(gx, gy + 0.1, 0, w, 0.8, 0.35);
    for (const x of [gx, gx + w - 0.2]) g.box(x, gy + 0.1, 0, 0.2, 0.8, 0.55);
    for (let x = gx + 1; x < gx + w; x++) g.line(g.at(x, gy + 0.1, 0.35), g.at(x, gy + 0.9, 0.35), g.C.line);
  }

  function sideTableBody(g, gx, gy) {
    g.box(gx + 0.2, gy + 0.2, 0, 0.6, 0.6, 0.45);
    g.box(gx + 0.3, gy + 0.35, 0.45, 0.3, 0.2, 0.06);
    g.cup(g.at(gx + 0.65, gy + 0.6, 0.45), 0.6);
  }

  function coffeeBody(g, gx, gy, w) {
    g.box(gx, gy + 0.1, 0, w, 0.8, 0.9);
    g.box(gx + 0.2, gy + 0.2, 0.9, 0.6, 0.5, 0.6);
    g.faceY(gx + 0.2, gy + 0.7, 0.1, 0.5, 1.1, 1.35, g.C.glass);
    for (const x of [gx + 1.4, gx + 1.8, gx + 2.3]) g.cup(g.at(x, gy + 0.5, 0.9), 0.7);
  }

  // Indicator dot and steam on the coffee machine while someone takes a break.
  function coffeeMachine(g, gx, gy, color, t) {
    const dot = g.at(gx + 0.5, gy + 0.7, 1.4);
    const { ctx, s } = g;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 1.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = color || g.C.line;
    ctx.fill();
    if (!color) return;
    const spout = g.at(gx + 0.5, gy + 0.45, 1.5);
    for (let k = 0; k < 2; k++) {
      const ph = ((t / 1000) * 0.5 + k * 0.5) % 1;
      const y0 = spout.y - ph * 10 * s;
      ctx.globalAlpha = 1 - ph;
      g.line({ x: spout.x + (k * 3 - 1.5) * s, y: y0 }, { x: spout.x + (k * 3 - 1) * s + Math.sin(t / 330 + k) * s, y: y0 - 3 * s }, g.C.muted);
      ctx.globalAlpha = 1;
    }
  }

  // Bookshelf against the left wall, its open side facing +gx.
  function shelfBody(g, gx, gy, d, h) {
    g.box(gx + 0.05, gy + 0.05, 0, 0.6, d - 0.1, h);
    const face = gx + 0.65;
    g.faceX(face, gy, 0.12, d - 0.12, 0.1, h - 0.1, g.C.glass);
    const rows = [0.15, 0.7, 1.25];
    for (const z of rows) g.line(g.at(face, gy + 0.12, z), g.at(face, gy + d - 0.12, z), g.C.line);
    // Books: neutral spines of varied width and height on each shelf.
    let n = 0;
    for (const z of rows) {
      let y = gy + 0.18;
      while (y < gy + d - 0.3) {
        const bw = 0.08 + ((n * 5) % 3) * 0.03;
        const bh = 0.32 + ((n * 7) % 4) * 0.04;
        g.faceX(face, 0, y, y + bw, z, z + bh, n % 2 ? g.C.deck : g.C.body);
        y += bw + 0.02 + (n % 5 === 4 ? 0.12 : 0);
        n++;
      }
    }
  }

  function potBody(g, cx, cy) {
    g.box(cx - 0.2, cy - 0.2, 0, 0.4, 0.4, 0.4);
  }

  function leaves(g, cx, cy, t, offset) {
    const base = g.at(cx, cy, 0.4);
    const { ctx, s } = g;
    const sway = Math.sin(t / 1250 + offset) * 1.5 * s;
    for (const [dx, h] of [[-5, 16], [0, 22], [5, 15], [-2, 12], [3, 18]]) {
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(base.x + dx * s, base.y - h * 0.5 * s, base.x + dx * 1.6 * s + sway, base.y - h * s);
      ctx.strokeStyle = g.C.line;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Office chair at a seat. `back` is the side of the backrest, away from the
  // furniture the sitter faces.
  function chairBody(g, cx, cy, back) {
    g.line(g.at(cx, cy, 0.02), g.at(cx, cy, 0.25), g.C.line);
    g.disc(g.at(cx, cy, 0.02), 0.3, g.C.body);
    g.box(cx - 0.22, cy - 0.22, 0.25, 0.44, 0.44, 0.07);
    if (back === 'y+') g.box(cx - 0.22, cy + 0.16, 0.32, 0.44, 0.06, 0.4);
    if (back === 'y-') g.box(cx - 0.22, cy - 0.22, 0.32, 0.44, 0.06, 0.4);
    if (back === 'x-') g.box(cx - 0.22, cy - 0.22, 0.32, 0.06, 0.44, 0.4);
    if (back === 'x+') g.box(cx + 0.16, cy - 0.22, 0.32, 0.06, 0.44, 0.4);
  }

  // Every piece in the room, from the floor plan. Footprints { x0, x1, y0, y1 }
  // are in grid units, for OfficeIso.drawOrder. `top` is the highest point in
  // tiles, for the sprite bounds. `use` names what lights the piece up.
  function pieces(map) {
    const out = [];
    const add = (piece) => out.push(piece);
    const rect = (f) => ({ x0: f.gx, x1: f.gx + f.w, y0: f.gy, y1: f.gy + f.d });
    for (const f of map.FURNITURE) {
      if (f.zone === 'desk') {
        // One desk per tile, so each sorts against avatars on its own.
        for (let i = 0; i < f.w; i++) {
          const gx = f.gx + i;
          const seat = map.ZONES.desk.seats.find((s) => s.gx === gx && s.gy === f.gy - 1);
          add({
            id: `desk.${gx}.${f.gy}`, x0: gx, x1: gx + 1, y0: f.gy, y1: f.gy + f.d, top: 1.2,
            use: seat ? `desk:${seat.id}` : null,
            body: (g) => deskBody(g, gx, f.gy, (gx + f.gy) % 3 === 0),
            live: (g, t, status, color) => deskScreen(g, gx, f.gy, status, color, t),
          });
        }
      } else if (f.zone === 'whiteboard') {
        add({
          id: 'whiteboard', ...rect(f), top: 2.7, use: 'whiteboard',
          body: (g) => boardBody(g, f.gx, f.gy, f.w),
          live: (g, t, status, color) => boardFace(g, f.gx, f.gy, f.w, status ? color : null),
        });
      } else if (f.zone === 'qa') {
        add({
          id: 'qa', ...rect(f), top: 1.6, use: 'qa',
          body: (g) => qaBody(g, f.gx, f.gy, f.w),
          live: (g, t, status, color) => qaScreens(g, f.gx, f.gy, status ? color : null, t),
        });
      } else if (f.zone === 'meeting') {
        const cx = f.gx + f.w / 2;
        const cy = f.gy + f.d / 2;
        add({
          id: 'meeting', ...rect(f), top: 1.4, use: 'meeting',
          body: (g) => meetingBody(g, cx, cy),
          live: (g, t, status, color) => meetingLamp(g, cx, cy, status ? color : null, t),
        });
      } else if (f.zone === 'lounge') {
        // The backrest stands a little behind the sofa's tiles.
        add({ id: 'sofa', ...rect(f), y0: f.gy - 0.15, top: 0.9, body: (g) => sofaBody(g, f.gx, f.gy, f.w) });
      } else if (f.zone === 'coffee') {
        add({
          id: 'coffee', ...rect(f), top: 1.7, use: 'coffee',
          body: (g) => coffeeBody(g, f.gx, f.gy, f.w),
          live: (g, t, status, color) => coffeeMachine(g, f.gx, f.gy, status ? color : null, t),
        });
      }
    }
    for (const d of map.DECOR) {
      const id = `${d.kind}.${d.gx}.${d.gy}`;
      const cx = d.gx + 0.5;
      const cy = d.gy + 0.5;
      if (d.kind === 'shelf') add({ id, ...rect(d), top: d.h + 0.2, body: (g) => shelfBody(g, d.gx, d.gy, d.d, d.h) });
      if (d.kind === 'sideTable') add({ id, ...rect(d), top: 0.7, body: (g) => sideTableBody(g, d.gx, d.gy) });
      if (d.kind === 'plant') {
        const offset = d.gx * 0.7 + d.gy;
        add({ id, ...rect(d), top: 2, body: (g) => potBody(g, cx, cy), live: (g, t) => leaves(g, cx, cy, t, offset) });
      }
    }
    // Chairs where agents sit at a desk, the QA station or the meeting table.
    const tables = map.FURNITURE.filter((f) => f.zone === 'meeting');
    for (const zone of ['desk', 'qa', 'meeting']) {
      for (const s of map.ZONES[zone].seats) {
        let back = zone === 'desk' ? 'y-' : 'y+';
        if (zone === 'meeting') back = tables.some((f) => s.gx < f.gx) ? 'x-' : 'x+';
        const cx = s.gx + 0.5;
        const cy = s.gy + 0.5;
        add({ id: `chair.${s.id}`, x0: cx - 0.25, x1: cx + 0.25, y0: cy - 0.25, y1: cy + 0.25, top: 0.8, body: (g) => chairBody(g, cx, cy, back) });
      }
    }
    return out;
  }

  return { pen, withAlpha, room, clockHands, pieces };
})(typeof module !== 'undefined' ? require('./iso.js') : OfficeIso);

if (typeof module !== 'undefined') module.exports = OfficeFurniture;
