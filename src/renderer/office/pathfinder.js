// A* on the office grid. Adapted from pixel-agent-desk src/office/office-pathfinder.js
// (MIT License, Copyright (c) 2025 geunilbae): the grid comes from map data instead
// of a collision image, moves are 4-way so paths never cut furniture corners, and an
// unreachable target returns null instead of a straight line through furniture.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in the
// Software without restriction, including without limitation the rights to use, copy,
// modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
// and to permit persons to whom the Software is furnished to do so, subject to the
// following conditions: The above copyright notice and this permission notice shall
// be included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

const OfficePathfinder = (() => {
  const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  function walkable(grid, gx, gy) {
    return gy >= 0 && gy < grid.length && gx >= 0 && gx < grid[0].length && grid[gy][gx];
  }

  // Tiles after start up to and including end; [] when already there; null when
  // end is blocked or cannot be reached.
  function findPath(grid, start, end) {
    if (!walkable(grid, end.gx, end.gy)) return null;
    if (start.gx === end.gx && start.gy === end.gy) return [];
    const width = grid[0].length;
    const key = (x, y) => y * width + x;
    const h = (x, y) => Math.abs(x - end.gx) + Math.abs(y - end.gy);

    const open = [{ gx: start.gx, gy: start.gy, g: 0, f: h(start.gx, start.gy), parent: null }];
    const best = new Map([[key(start.gx, start.gy), 0]]);
    const closed = new Set();
    while (open.length) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift();
      const k = key(cur.gx, cur.gy);
      if (closed.has(k)) continue;
      closed.add(k);
      if (cur.gx === end.gx && cur.gy === end.gy) {
        const path = [];
        for (let n = cur; n.parent; n = n.parent) path.unshift({ gx: n.gx, gy: n.gy });
        return path;
      }
      for (const [dx, dy] of DIRS) {
        const nx = cur.gx + dx;
        const ny = cur.gy + dy;
        if (!walkable(grid, nx, ny) || closed.has(key(nx, ny))) continue;
        const g = cur.g + 1;
        if (g >= (best.get(key(nx, ny)) ?? Infinity)) continue;
        best.set(key(nx, ny), g);
        open.push({ gx: nx, gy: ny, g, f: g + h(nx, ny), parent: cur });
      }
    }
    return null;
  }

  return { walkable, findPath };
})();

if (typeof module !== 'undefined') module.exports = OfficePathfinder;
