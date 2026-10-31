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

  return { TILE_W, TILE_H, project, unproject, depthKey };
})();

if (typeof module !== 'undefined') module.exports = OfficeIso;
