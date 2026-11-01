// Isometric office on Canvas 2D (office-life spec). Each frame reads the agent list
// (kept current by store events in app.js), moves avatars toward their zone, and
// redraws. The RAF loop follows pixel-agent-desk src/office/office-renderer.js
// (MIT License, Copyright (c) 2025 geunilbae; notice in pathfinder.js).
//
// CPU (spec §5): the room renders once into an offscreen layer and every piece of
// furniture into its own sprite, again only on resize. A frame blits those, draws
// the live parts and avatars, and is capped at 30 fps. The loop stops while the
// window is hidden, the owner hides the office, or the canvas is not displayed
// (Settings open).

// Live avatar state, readable from devtools while checking the office.
let officeState = null;

function startOffice(canvas, { getAgents, onSelect, getSelected = () => null }) {
  const { project, drawOrder } = OfficeIso;
  const { WIDTH, HEIGHT } = OfficeMap;
  const ctx = canvas.getContext('2d');

  // Canvas cannot read CSS variables, so resolve the design tokens once.
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  const resolve = (value) => (value.startsWith('var(') ? token(value.slice(4, -1)) : value);
  const C = {
    floor: token('--office-floor'),
    body: token('--office-body'),
    deck: token('--office-deck'),
    line: token('--office-line'),
    detail: token('--office-detail'),
    glass: token('--office-glass'),
    surface: token('--surface'),
    edge: token('--border'),
    text: token('--text'),
    muted: token('--muted'),
    ring: token('--accent-text'),
    font: token('--font'),
  };
  const colorOf = (status) => resolve((STATUS[status] || STATUS.idle).color);
  const looks = new Map();
  function lookOf(id) {
    if (!looks.has(id)) {
      const a = OfficeLook.appearanceFor(id);
      looks.set(id, { hair: token(a.hair), hairStyle: a.hairStyle, seed: OfficeLook.hash(id) });
    }
    return looks.get(id);
  }

  const pieces = OfficeFurniture.pieces(OfficeMap);
  const chars = new Map();
  officeState = { chars, frames: 0 };
  let view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 0 };
  let roomLayer = null;
  const sprites = new Map();

  // Grid point to CSS pixels on the canvas.
  function at(gx, gy, gz = 0) {
    const p = project(gx, gy, gz);
    return { x: view.ox + p.x * view.s, y: view.oy + p.y * view.s };
  }

  // Draw into a new offscreen canvas covering CSS pixels x..x+w, y..y+h.
  function offscreen(x, y, w, h, paint) {
    const layer = document.createElement('canvas');
    layer.width = Math.max(1, Math.ceil(w * view.dpr));
    layer.height = Math.max(1, Math.ceil(h * view.dpr));
    const c = layer.getContext('2d');
    c.setTransform(view.dpr, 0, 0, view.dpr, -x * view.dpr, -y * view.dpr);
    paint(OfficeFurniture.pen(c, at, view.s, C));
    return { img: layer, x, y, w, h };
  }

  // Fit the room to the canvas; rebuild the static layers when the size changed.
  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === view.w && h === view.h && dpr === view.dpr) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const left = project(0, HEIGHT).x;
    const right = project(WIDTH, 0).x;
    // Room above the back wall for the whiteboard, marks and name tags.
    const top = project(0, 0, 4.2).y;
    const bottom = project(WIDTH, HEIGHT, -0.6).y;
    const s = Math.max(0.2, Math.min((w - 32) / (right - left), (h - 32) / (bottom - top), 3));
    view = { s, w, h, dpr, ox: (w - (right - left) * s) / 2 - left * s, oy: (h - (bottom - top) * s) / 2 - top * s };
    if (!w || !h) return;
    roomLayer = offscreen(0, 0, w, h, (g) => OfficeFurniture.room(g, WIDTH, HEIGHT));
    sprites.clear();
    for (const p of pieces) {
      const pts = [];
      for (const [x, y] of [[p.x0, p.y0], [p.x1, p.y0], [p.x0, p.y1], [p.x1, p.y1]]) pts.push(at(x, y, -0.1), at(x, y, p.top));
      const pad = 4;
      const x0 = Math.floor(Math.min(...pts.map((q) => q.x))) - pad;
      const y0 = Math.floor(Math.min(...pts.map((q) => q.y))) - pad;
      const x1 = Math.ceil(Math.max(...pts.map((q) => q.x))) + pad;
      const y1 = Math.ceil(Math.max(...pts.map((q) => q.y))) + pad;
      sprites.set(p.id, offscreen(x0, y0, x1 - x0, y1 - y0, p.body));
    }
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

  // Which equipment an arrived agent is using, keyed like a piece's `use`.
  function inUse() {
    const use = new Map();
    for (const ch of chars.values()) {
      if (ch.path.length) continue;
      const key = ch.zone === 'desk' ? (ch.seat ? `desk:${ch.seat}` : null) : ch.zone;
      if (key && !use.has(key)) use.set(key, ch.status);
    }
    return use;
  }

  // Name tags go on top of everything, so furniture never hides who is who.
  function drawTag(label, x, headTop, selected) {
    ctx.font = `11px ${C.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 10;
    const ty = headTop - 12;
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, ty - 8, tw, 16, 4);
    ctx.fillStyle = C.surface;
    ctx.fill();
    ctx.strokeStyle = selected ? C.ring : C.edge;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.fillText(label, x, ty);
  }

  // Chair and sofa seat height in tiles.
  const SEAT_Z = 0.32;

  // Screen boxes of the avatars drawn last frame, front-most last, for click-picking.
  let hits = [];

  function draw(t) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.drawImage(roomLayer.img, 0, 0, view.w, view.h);
    const g = OfficeFurniture.pen(ctx, at, view.s, C);
    OfficeFurniture.clockHands(g, new Date());

    const selected = getSelected();
    const use = inUse();
    const points = standPoints();
    const items = [...pieces];
    for (const ch of chars.values()) {
      const p = points.get(ch.id);
      const r = 0.2;
      // After a chair on the same tile: the sitter is drawn over it.
      items.push({ ch, p, x0: p.gx - r, x1: p.gx + r, y0: p.gy - r, y1: p.gy + r, bias: 0.01 });
    }
    hits = [];
    const tags = [];
    for (const it of drawOrder(items)) {
      if (!it.ch) {
        const sp = sprites.get(it.id);
        ctx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h);
        if (it.live) {
          const status = it.use ? use.get(it.use) || null : null;
          it.live(g, t, status, status ? colorOf(status) : null);
        }
        continue;
      }
      const { ch, p } = it;
      const walking = ch.path.length > 0;
      const pose = OfficeLook.poseFor(ch.status, { walking, seated: Boolean(ch.seat) && !walking });
      // On the sofa the sitter leans back into it, half a tile behind the seat tile.
      const back = !walking && ch.zone === 'lounge' && ch.seat ? 0.5 : 0;
      const look = lookOf(ch.id);
      const floor = at(p.gx, p.gy - back);
      const box = OfficeAvatar.draw(g, {
        floor,
        foot: pose.standing ? floor : at(p.gx, p.gy - back, SEAT_Z),
        ...pose,
        color: colorOf(ch.status),
        ...look,
        t,
        selected: ch.id === selected,
      }, C);
      hits.push({ id: ch.id, ...box });
      tags.push({ label: ch.name, x: at(p.gx, p.gy - back).x, headTop: box.headTop, selected: ch.id === selected });
    }
    for (const tag of tags) drawTag(tag.label, tag.x, tag.headTop, tag.selected);
    officeState.hits = hits;
    officeState.frames++;
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

  // Hidden by the owner (layout toggle): no frames until shown again.
  let hiddenByLayout = false;
  const shown = () => !document.hidden && !hiddenByLayout && canvas.offsetParent !== null;

  const FRAME_MS = 1000 / 30;
  // Between frames the loop sleeps on a timer, so a 144 or 240 Hz display does not
  // wake it for frames it would skip; the frame itself still runs in rAF.
  let raf = 0;
  let timer = 0;
  let last = 0;
  let due = 0;
  function frame(now) {
    raf = 0;
    if (!shown()) return;
    // Up to 2 ms early still counts, so vsync jitter does not drop a frame.
    if (now < due - 2) {
      raf = requestAnimationFrame(frame);
      return;
    }
    // Real time, clamped so a long pause does not turn into one giant step.
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    due = Math.max(due + FRAME_MS, now - 2);
    OfficeCharacters.sync(chars, getAgents());
    for (const ch of chars.values()) OfficeCharacters.step(ch, dt);
    layout();
    if (roomLayer && view.w && view.h) draw(now);
    timer = setTimeout(() => {
      timer = 0;
      if (shown()) raf = requestAnimationFrame(frame);
    }, Math.max(0, due - performance.now() - 8));
  }
  function run() {
    if (raf || timer || !shown()) return;
    last = performance.now() - FRAME_MS;
    due = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    raf = 0;
    timer = 0;
  }
  const update = () => (shown() ? run() : pause());
  // Settings hides the column with display:none; the canvas size changes then and
  // again when it is back.
  const observer = new ResizeObserver(update);

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('mousemove', onMove);
  document.addEventListener('visibilitychange', update);
  observer.observe(canvas);
  run();

  return {
    setHidden(hidden) {
      hiddenByLayout = hidden;
      update();
    },
    stop() {
      pause();
      observer.disconnect();
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', update);
    },
  };
}
