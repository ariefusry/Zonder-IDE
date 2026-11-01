// Isometric projection. The office lives on a logical grid (gx, gy, and height
// gz in tile units); only this file knows how a grid point becomes a screen point.
// Each office file is one namespace object, since classic scripts share globals.

const OfficeIso = (() => {
  const TILE_W = 32;
  const TILE_H = 16;

  function project(gx, gy, gz = 0) {
    return { x: (gx - gy) * TILE_W / 2, y: (gx + gy) * TILE_H / 2 - gz * TILE_H };
  }

  // Inverse of project at floor level (gz = 0).
  function unproject(x, y) {
    const a = x / (TILE_W / 2);
    const b = y / (TILE_H / 2);
    return { gx: (a + b) / 2, gy: (b - a) / 2 };
  }

  // Draw order: what stands lower on the screen is nearer the viewer, so it is drawn later.
  function depthKey(footY) {
    return footY;
  }

  // a ends before b starts on one grid axis, so a is further from the viewer.
  const behind = (a, b) => a.x1 <= b.x0 || a.y1 <= b.y0;
  const key = (it) => it.x0 + it.x1 + it.y0 + it.y1 + (it.bias || 0);

  // Painter's order for items with a floor footprint { x0, x1, y0, y1 } in grid
  // units. One depth number per item cannot order a three-tile sofa against an
  // avatar standing behind its far end, so items are ordered pairwise: a footprint
  // that ends before another starts on one axis goes first. Overlapping footprints
  // (an avatar on its chair) and side-by-side ones go by depth, then `bias`.
  function drawOrder(items) {
    const n = items.length;
    const next = items.map(() => []);
    const waiting = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ab = behind(items[i], items[j]);
        const ba = behind(items[j], items[i]);
        if (ab && ba) continue;
        const first = ab || (!ba && key(items[i]) <= key(items[j])) ? i : j;
        const second = first === i ? j : i;
        next[first].push(second);
        waiting[second]++;
      }
    }
    const out = [];
    const done = new Array(n).fill(false);
    while (out.length < n) {
      // Nearest-to-the-back item that waits on nothing; on a cycle, the
      // nearest-to-the-back of what is left.
      let pick = -1;
      for (let i = 0; i < n; i++) {
        if (done[i]) continue;
        if (pick < 0 || (waiting[i] === 0 && (waiting[pick] > 0 || key(items[i]) < key(items[pick])))) pick = i;
        else if (waiting[pick] > 0 && waiting[i] > 0 && key(items[i]) < key(items[pick])) pick = i;
      }
      done[pick] = true;
      out.push(items[pick]);
      for (const k of next[pick]) waiting[k]--;
    }
    return out;
  }

  return { TILE_W, TILE_H, project, unproject, depthKey, drawOrder };
})();

if (typeof module !== 'undefined') module.exports = OfficeIso;
