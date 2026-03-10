/**
 * A* Pathfinder for grid-based maps.
 * Pure JS — no framework dependency.
 */
export default class PathFinder {
  /**
   * @param {number[][]} grid  2D array: 0 = walkable, 1 = blocked
   * @param {number} tileW     tile width in pixels
   * @param {number} tileH     tile height in pixels
   */
  constructor(grid, tileW, tileH) {
    this.grid  = grid;
    this.rows  = grid.length;
    this.cols  = grid[0].length;
    this.tileW = tileW;
    this.tileH = tileH;

    // Pre-compute walkable tile list for random selection
    this._walkable = [];
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++)
        if (grid[y][x] === 0) this._walkable.push({ x, y });
  }

  isWalkable(tx, ty) {
    return tx >= 0 && tx < this.cols && ty >= 0 && ty < this.rows
           && this.grid[ty][tx] === 0;
  }

  pixelToTile(px, py) {
    return {
      x: Math.max(0, Math.min(this.cols - 1, Math.floor(px / this.tileW))),
      y: Math.max(0, Math.min(this.rows - 1, Math.floor(py / this.tileH))),
    };
  }

  tileToPixel(tx, ty) {
    return { x: tx * this.tileW + this.tileW / 2, y: ty * this.tileH + this.tileH };
  }

  /**
   * A* search from (sx,sy) to (ex,ey) in tile coordinates.
   * Returns array of {x,y} tile coords including start and end, or null.
   */
  findPath(sx, sy, ex, ey) {
    if (!this.isWalkable(sx, sy) || !this.isWalkable(ex, ey)) return null;
    if (sx === ex && sy === ey) return [{ x: sx, y: sy }];

    const key = (x, y) => `${x},${y}`;
    const heuristic = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // 4-directional

    const openMap   = new Map();
    const closedSet = new Set();
    const gScore    = new Map();
    const parent    = new Map();

    const sk = key(sx, sy);
    gScore.set(sk, 0);
    openMap.set(sk, { x: sx, y: sy, f: heuristic(sx, sy, ex, ey) });

    while (openMap.size > 0) {
      let bestKey = null, bestF = Infinity;
      for (const [k, node] of openMap) {
        if (node.f < bestF) { bestF = node.f; bestKey = k; }
      }

      const cur = openMap.get(bestKey);
      openMap.delete(bestKey);

      if (cur.x === ex && cur.y === ey) {
        const path = [];
        let ck = key(ex, ey);
        while (ck !== undefined) {
          const [cx, cy] = ck.split(',').map(Number);
          path.unshift({ x: cx, y: cy });
          ck = parent.get(ck);
        }
        return path;
      }

      closedSet.add(bestKey);
      const curG = gScore.get(bestKey) || 0;

      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx, ny = cur.y + dy;
        const nk = key(nx, ny);
        if (closedSet.has(nk) || !this.isWalkable(nx, ny)) continue;

        const g = curG + 1;
        if (g < (gScore.get(nk) ?? Infinity)) {
          parent.set(nk, bestKey);
          gScore.set(nk, g);
          openMap.set(nk, { x: nx, y: ny, f: g + heuristic(nx, ny, ex, ey) });
        }
      }
    }

    return null; // unreachable
  }

  /** Random walkable tile. */
  getRandomWalkable() {
    if (!this._walkable.length) return null;
    return this._walkable[Math.floor(Math.random() * this._walkable.length)];
  }

  /** Random walkable tile at least `minDist` tiles from (fx,fy). */
  getRandomWalkableFar(fx, fy, minDist) {
    const far = this._walkable.filter(t =>
      Math.abs(t.x - fx) + Math.abs(t.y - fy) >= minDist
    );
    if (!far.length) return this.getRandomWalkable();
    return far[Math.floor(Math.random() * far.length)];
  }
}
