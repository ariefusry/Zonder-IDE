// Isometric office on Canvas 2D. Each frame reads the agent list (kept current by
// store events in app.js), moves avatars toward their zone, and redraws. The RAF
// loop follows pixel-agent-desk src/office/office-renderer.js (MIT License,
// Copyright (c) 2025 geunilbae; notice in pathfinder.js).

// Live avatar state, readable from devtools while checking the office.
let officeState = null;

function startOffice(canvas, { getAgents, onSelect, getSelected = () => null }) {
  const { project, depthKey } = OfficeIso;
  const { WIDTH, HEIGHT, FURNITURE, ZONES } = OfficeMap;
  const ctx = canvas.getContext('2d');

  // Canvas cannot read CSS variables, so resolve the design tokens once.
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  const resolve = (value) => (value.startsWith('var(') ? token(value.slice(4, -1)) : value);
  const C = {
    floor: token('--surface'),
    edge: token('--border'),
    text: token('--text'),
    muted: token('--muted'),
    ring: token('--accent-text'),
    error: token('--st-error'),
    font: token('--font'),
    // Furniture shades sit between --surface-2 and --border so it reads above the floor.
    top: '#26262a',
    left: token('--surface-2'),
    right: '#202023',
    rim: '#3a3a40',
  };

  const chars = new Map();
  officeState = { chars };
  let view = { s: 1, ox: 0, oy: 0, w: 0, h: 0 };

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const left = project(0, HEIGHT).x;
    const right = project(WIDTH, 0).x;
    // Room above the back wall for the whiteboard and name tags.
    const top = project(0, 0, 3).y;
    const bottom = project(WIDTH, HEIGHT).y;
    const s = Math.max(0.2, Math.min((w - 32) / (right - left), (h - 32) / (bottom - top), 3));
    view = { s, w, h, ox: (w - (right - left) * s) / 2 - left * s, oy: (h - (bottom - top) * s) / 2 - top * s };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  // Grid point to CSS pixels on the canvas.
  function at(gx, gy, gz = 0) {
    const p = project(gx, gy, gz);
    return { x: view.ox + p.x * view.s, y: view.oy + p.y * view.s };
  }

  function poly(points, fill, stroke) {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawFloor() {
    poly([at(0, 0), at(WIDTH, 0), at(WIDTH, HEIGHT), at(0, HEIGHT)], C.floor, C.edge);
  }

  // Furniture is drawn one tile at a time so each tile sorts against avatars on its own.
  // The zone name sits on top of the zone's first piece of furniture.
  function furnitureSlices() {
    const slices = [];
    const named = new Set();
    for (const f of FURNITURE) {
      if (!named.has(f.zone)) {
        named.add(f.zone);
        const cx = f.gx + f.w / 2;
        const cy = f.gy + f.d / 2;
        // After the furniture's front tile, so no tile of it covers the name.
        slices.push({ depth: depthKey(project(f.gx + f.w - 0.5, f.gy + f.d - 0.5).y) + 0.005, draw: () => drawZoneName(ZONES[f.zone].name, at(cx, cy, f.h)) });
      }
      const inside = (x, y) => x >= f.gx && x < f.gx + f.w && y >= f.gy && y < f.gy + f.d;
      for (let y = f.gy; y < f.gy + f.d; y++) {
        for (let x = f.gx; x < f.gx + f.w; x++) {
          slices.push({
            depth: depthKey(project(x + 0.5, y + 0.5).y),
            draw: () => drawSlice(f, x, y, inside),
          });
        }
      }
    }
    return slices;
  }

  function drawZoneName(name, p) {
    ctx.font = `11px ${C.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.muted;
    ctx.fillText(name, p.x, p.y);
  }

  function drawSlice(f, x, y, inside) {
    const h = f.h;
    // Only outer faces and edges, so a desk reads as one block.
    if (!inside(x, y + 1)) poly([at(x, y + 1, h), at(x + 1, y + 1, h), at(x + 1, y + 1), at(x, y + 1)], f.zone === 'whiteboard' ? C.rim : C.left);
    if (!inside(x + 1, y)) poly([at(x + 1, y, h), at(x + 1, y + 1, h), at(x + 1, y + 1), at(x + 1, y)], C.right);
    poly([at(x, y, h), at(x + 1, y, h), at(x + 1, y + 1, h), at(x, y + 1, h)], C.top);
    ctx.strokeStyle = C.rim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const edge = (a, b) => { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };
    if (!inside(x, y - 1)) edge(at(x, y, h), at(x + 1, y, h));
    if (!inside(x + 1, y)) edge(at(x + 1, y, h), at(x + 1, y + 1, h));
    if (!inside(x, y + 1)) edge(at(x + 1, y + 1, h), at(x, y + 1, h));
    if (!inside(x - 1, y)) edge(at(x, y + 1, h), at(x, y, h));
    ctx.stroke();
  }

  // Avatars without a seat share their zone's overflow tile; spread them sideways.
  function standPoints() {
    const groups = new Map();
    for (const ch of chars.values()) {
      if (ch.seat || ch.path.length) continue;
      if (!groups.has(ch.zone)) groups.set(ch.zone, []);
      groups.get(ch.zone).push(ch);
    }
    const points = new Map();
    for (const ch of chars.values()) points.set(ch.id, { gx: ch.x + 0.5, gy: ch.y + 0.5 });
    for (const list of groups.values()) {
      list.forEach((ch, i) => {
        const off = (i - (list.length - 1) / 2) * 0.45;
        points.set(ch.id, { gx: ch.x + 0.5 + off, gy: ch.y + 0.5 - off });
      });
    }
    return points;
  }

  function drawAvatar(ch, foot, selected) {
    const u = view.s;
    const color = resolve(STATUS[ch.status].color);
    if (selected) {
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y, 11 * u, 5.5 * u, 0, 0, Math.PI * 2);
      ctx.strokeStyle = C.ring;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(foot.x, foot.y, 7 * u, 3.5 * u, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.edge;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(foot.x - 5 * u, foot.y - 17 * u, 10 * u, 15 * u, 3 * u);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(foot.x, foot.y - 21.5 * u, 4.5 * u, 0, Math.PI * 2);
    ctx.fillStyle = C.text;
    ctx.fill();

    if (OfficeCharacters.avatarLook(ch.status).flag === 'error') {
      const px = foot.x + 10 * u;
      ctx.strokeStyle = C.text;
      ctx.lineWidth = Math.max(1, u);
      ctx.beginPath();
      ctx.moveTo(px, foot.y);
      ctx.lineTo(px, foot.y - 30 * u);
      ctx.stroke();
      poly([{ x: px, y: foot.y - 30 * u }, { x: px + 11 * u, y: foot.y - 26 * u }, { x: px, y: foot.y - 22 * u }], C.error);
    }
  }

  // Name tags go on top of everything, so furniture never hides who is who.
  function drawTag(label, foot, selected) {
    const u = view.s;
    ctx.font = `11px ${C.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 10;
    const ty = foot.y - 26 * u - 10;
    ctx.beginPath();
    ctx.roundRect(foot.x - tw / 2, ty - 8, tw, 16, 4);
    ctx.fillStyle = C.floor;
    ctx.fill();
    ctx.strokeStyle = selected ? C.ring : C.edge;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.fillText(label, foot.x, ty);
  }

  // Screen boxes of the avatars drawn last frame, front-most last, for click-picking.
  let hits = [];

  function draw() {
    layout();
    ctx.clearRect(0, 0, view.w, view.h);
    drawFloor();
    const selected = getSelected();
    const points = standPoints();
    const items = furnitureSlices();
    for (const ch of chars.values()) {
      const p = points.get(ch.id);
      const foot = at(p.gx, p.gy);
      // Avatars after furniture on the same depth: they stand in front of it.
      items.push({ depth: depthKey(project(p.gx, p.gy).y) + 0.01, ch, foot });
    }
    items.sort((a, b) => a.depth - b.depth);
    hits = [];
    for (const it of items) {
      if (it.draw) {
        it.draw();
        continue;
      }
      drawAvatar(it.ch, it.foot, it.ch.id === selected);
      const u = view.s;
      hits.push({ id: it.ch.id, x0: it.foot.x - 9 * u, x1: it.foot.x + 9 * u, y0: it.foot.y - 26 * u - 18, y1: it.foot.y + 4 * u });
    }
    for (const it of items) if (it.ch) drawTag(it.ch.name, it.foot, it.ch.id === selected);
    officeState.hits = hits;
  }

  function hitAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h.id;
    }
    return null;
  }

  const onClick = (e) => {
    const id = hitAt(e);
    if (id) onSelect(id);
  };
  const onMove = (e) => canvas.style.setProperty('cursor', hitAt(e) ? 'pointer' : 'default');

  let raf = 0;
  let last = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    // Clamp, so a long pause does not turn into one giant step.
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    OfficeCharacters.sync(chars, getAgents());
    for (const ch of chars.values()) OfficeCharacters.step(ch, dt);
    draw();
  }
  function run() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  // Hidden by the owner (layout toggle): no frames until shown again.
  let hiddenByLayout = false;
  const onVisibility = () => (document.hidden || hiddenByLayout ? pause() : run());

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('mousemove', onMove);
  document.addEventListener('visibilitychange', onVisibility);
  run();

  return {
    setHidden(hidden) {
      hiddenByLayout = hidden;
      onVisibility();
    },
    stop() {
      pause();
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
