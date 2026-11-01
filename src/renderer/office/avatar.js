// One avatar in the fine-line style (office-life spec §4.1, §4.2): neutral head
// with hair from the agent id, a body in the status colour, a pose and a mark
// from OfficeLook.poseFor. Draws only; office.js decides where and when.

const OfficeAvatar = ((look) => {
  const TAU = Math.PI * 2;

  // a: { floor, foot (seat point when sitting), pose, standing, mark, color, hair, hairStyle, seed, t, selected }
  // g: OfficeFurniture.pen for the canvas. Returns the hit box and head top.
  function draw(g, a, C) {
    const { ctx } = g;
    // A little larger than the prototype, so poses read (spec §4.4).
    const u = g.s * 1.2;
    const { foot, color, t } = a;
    const floor = a.floor || foot;
    const offset = (a.seed % 997) / 997;
    const sit = !a.standing;

    // Floor shadow, and the selection ring around it.
    ctx.beginPath();
    ctx.ellipse(floor.x, floor.y, 7 * u, 3.5 * u, 0, 0, TAU);
    ctx.fillStyle = C.detail;
    ctx.fill();
    if (a.selected) {
      ctx.beginPath();
      ctx.ellipse(floor.x, floor.y, 11 * u, 5.5 * u, 0, 0, TAU);
      ctx.strokeStyle = C.ring;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const step = a.pose === 'walk' ? Math.sin(look.phase(t, 560, offset) * TAU) : 0;
    // Breath: one pixel up and down.
    const breath = a.pose === 'walk' ? 0 : Math.sin(look.phase(t, 3600, offset) * TAU) * 0.5;
    const hip = { x: foot.x, y: foot.y - (sit ? 1 : 10) * u };

    // Legs.
    if (sit) {
      for (const dx of [-2, 2]) {
        // Thighs forward along the seat, shins down to the floor.
        const knee = { x: hip.x + dx * 1.3 * u, y: hip.y + 2 * u };
        g.line({ x: hip.x + dx * u, y: hip.y }, knee, C.line, 1.5 * u);
        g.line(knee, { x: knee.x, y: floor.y - 0.5 * u }, C.line, 1.5 * u);
      }
    } else {
      for (const [dx, k] of [[-2, 1], [2, -1]]) {
        g.line({ x: hip.x + dx * u, y: hip.y }, { x: foot.x + (dx + step * 3 * k) * u, y: foot.y }, C.line, 1.5 * u);
      }
    }

    // Body in the status colour.
    const bw = 9 * u;
    const bh = 12 * u;
    const top = { x: hip.x, y: hip.y - bh + breath };
    ctx.beginPath();
    ctx.roundRect(top.x - bw / 2, top.y, bw, bh, 3 * u);
    ctx.fillStyle = OfficeFurniture.withAlpha(color, 0.35);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Head, eyes that blink every 3 to 6 s, hair.
    const facepalm = a.pose === 'facepalm';
    const head = { x: top.x + (facepalm ? Math.sin(t / 400) * 0.6 * u : 0), y: top.y - 5 * u };
    const r = 4.2 * u;
    ctx.beginPath();
    ctx.arc(head.x, head.y, r, 0, TAU);
    ctx.fillStyle = C.deck;
    ctx.fill();
    ctx.strokeStyle = C.muted;
    ctx.stroke();
    const blink = look.phase(t, 3000 + (a.seed % 3000), offset) < 0.05;
    for (const dx of [-1.6, 1.6]) {
      const e = { x: head.x + dx * u, y: head.y + 1.2 * u };
      if (blink || facepalm) g.line({ x: e.x - 0.7 * u, y: e.y }, { x: e.x + 0.7 * u, y: e.y }, C.muted);
      else {
        ctx.beginPath();
        ctx.arc(e.x, e.y, 0.6 * u, 0, TAU);
        ctx.fillStyle = C.muted;
        ctx.fill();
      }
    }
    ctx.fillStyle = a.hair;
    ctx.beginPath();
    ctx.arc(head.x, head.y, r, Math.PI, TAU);
    ctx.closePath();
    ctx.fill();
    if (a.hairStyle === 1) {
      // Longer hair down both sides.
      ctx.fillRect(head.x - r, head.y - 0.2 * u, 1.4 * u, 3.4 * u);
      ctx.fillRect(head.x + r - 1.4 * u, head.y - 0.2 * u, 1.4 * u, 3.4 * u);
    } else if (a.hairStyle === 2) {
      // Bun on top.
      ctx.beginPath();
      ctx.arc(head.x + 1 * u, head.y - r - 0.6 * u, 1.8 * u, 0, TAU);
      ctx.fill();
    }

    // Arms per pose, from the shoulders.
    const shoulder = { x: top.x, y: top.y + 3 * u };
    const arm = (dx, ex, ey) => g.line({ x: shoulder.x + dx * u, y: shoulder.y }, { x: shoulder.x + ex * u, y: shoulder.y + ey * u }, color, 1.5 * u);
    const T = t / 1000;
    if (a.pose === 'type') {
      const k = look.phase(t, 260, offset) < 0.5;
      arm(-4, -3, k ? 5 : 7);
      arm(4, 3, k ? 7 : 5);
    } else if (a.pose === 'board') {
      arm(4, 7 + Math.sin(T * 3) * 0.8, -10);
      arm(-4, -5, 8);
    } else if (a.pose === 'sip') {
      const sipping = look.phase(t, 6000, offset) < 0.2;
      const hand = { x: shoulder.x + 6 * u, y: shoulder.y + (sipping ? -5 : 4) * u };
      g.line({ x: shoulder.x + 4 * u, y: shoulder.y }, hand, color, 1.5 * u);
      arm(-4, -5, 8);
      g.cup({ x: hand.x + 2 * u, y: hand.y + 2 * u }, 1.2, C.muted);
      for (let k = 0; k < 2; k++) {
        const ph = (T * 0.6 + k * 0.5) % 1;
        const y0 = hand.y - 4 * u - ph * 10 * u;
        ctx.globalAlpha = 1 - ph;
        g.line({ x: hand.x + (1 + k * 2) * u, y: y0 }, { x: hand.x + (2 + k * 2) * u + Math.sin(T * 3 + k) * u, y: y0 - 3 * u }, C.muted);
        ctx.globalAlpha = 1;
      }
    } else if (a.pose === 'raise') {
      arm(4, 6 + Math.sin(T * 6) * 1.5, -15);
      arm(-4, -5, 8);
    } else if (a.pose === 'qa') {
      arm(-4, -4, 6);
      arm(4, 4, 6 + Math.sin(T * 2) * 0.5);
    } else if (a.pose === 'lounge') {
      arm(-4, -8, 1);
      arm(4, 8, 1);
    } else if (a.pose === 'facepalm') {
      arm(-4, -3, -7);
      arm(4, 3, -7);
    } else if (a.pose === 'walk') {
      arm(-4, -5 - step * 2, 7);
      arm(4, 5 + step * 2, 7);
    }

    // Mark beside the head. Approval is the largest and the only one that pulses.
    const mark = { x: head.x + 11 * u, y: head.y - 3 * u };
    if (a.mark === 'dots') {
      for (let k = 0; k < 3; k++) {
        const on = Math.floor(T * 3) % 3 === k;
        ctx.beginPath();
        ctx.arc(mark.x - 4 * u + k * 4 * u, mark.y, 1.5 * u, 0, TAU);
        ctx.fillStyle = on ? color : C.line;
        ctx.fill();
      }
    } else if (a.mark === 'alert') {
      bubble(ctx, mark, (7 + Math.sin(T * 5) * 1.4) * u, color, C, '!', u, true);
    } else if (a.mark === 'error') {
      bubble(ctx, mark, 5.5 * u, color, C, '!', u, false);
    } else if (a.mark === 'check') {
      bubble(ctx, mark, 4.5 * u, color, C, null, u, false);
      g.line({ x: mark.x - 2 * u, y: mark.y }, { x: mark.x - 0.5 * u, y: mark.y + 1.6 * u }, color, 1.2 * u);
      g.line({ x: mark.x - 0.5 * u, y: mark.y + 1.6 * u }, { x: mark.x + 2.2 * u, y: mark.y - 1.6 * u }, color, 1.2 * u);
    }

    return { x0: foot.x - 9 * u, x1: foot.x + 9 * u, y0: head.y - r - 4 * u, y1: floor.y + 4 * u, headTop: head.y - r };
  }

  function bubble(ctx, c, r, color, C, glyph, u, glow) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, TAU);
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 12 * u;
    }
    ctx.fillStyle = C.glass;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.lineWidth = 1;
    if (!glyph) return;
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.round(r * 1.5)}px ${C.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, c.x, c.y + 0.5 * u);
  }

  return { draw };
})(typeof module !== 'undefined' ? require('./look.js') : OfficeLook);

if (typeof module !== 'undefined') module.exports = OfficeAvatar;
