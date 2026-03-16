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
    this.rawGrid = grid.map((row) => row.slice());
    this.rows  = this.rawGrid.length;
    this.cols  = this.rawGrid[0].length;
    this.tileW = tileW;
    this.tileH = tileH;
    this.footPaddingX = Math.max(4, Math.round(this.tileW * 0.18));
    this.footPaddingY = Math.max(3, Math.round(this.tileH * 0.12));
    this.footInsetY = Math.max(2, Math.round(this.tileH * 0.08));
    this.grid = this._buildNavigationGrid();

    // Pre-compute walkable tile list for random selection
    this._walkable = [];
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++)
        if (this.grid[y][x] === 0) this._walkable.push({ x, y });
  }

  _isWalkableInGrid(grid, tx, ty) {
    return tx >= 0 && tx < this.cols && ty >= 0 && ty < this.rows
      && grid[ty][tx] === 0;
  }

  _isBlockedInRawGrid(tx, ty) {
    return !this._isWalkableInGrid(this.rawGrid, tx, ty);
  }

  _buildNavigationGrid() {
    const next = this.rawGrid.map((row) => row.slice());

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.rawGrid[y][x] !== 0) continue;

        const leftBlocked = this._isBlockedInRawGrid(x - 1, y);
        const rightBlocked = this._isBlockedInRawGrid(x + 1, y);
        const upBlocked = this._isBlockedInRawGrid(x, y - 1);
        const downBlocked = this._isBlockedInRawGrid(x, y + 1);
        const blockedCount = Number(leftBlocked) + Number(rightBlocked) + Number(upBlocked) + Number(downBlocked);

        // Treat very tight squeeze points as blocked so large sprites stay a
        // little farther away from props and wall silhouettes.
        const horizontalSqueeze = leftBlocked && rightBlocked;
        const verticalSqueeze = upBlocked && downBlocked;
        const pocketed = blockedCount >= 3;
        if (horizontalSqueeze || verticalSqueeze || pocketed) {
          next[y][x] = 1;
        }
      }
    }

    return next;
  }

  isWalkable(tx, ty) {
    return this._isWalkableInGrid(this.grid, tx, ty);
  }

  pixelToTile(px, py) {
    // NPC containers use bottom-center as the logical "feet" point.
    // `tileToPixel()` returns the exact bottom edge of a tile, so we need
    // a tiny epsilon here to keep the inverse mapping stable on boundaries.
    const footEpsilon = 1e-6;
    return {
      x: Math.max(0, Math.min(this.cols - 1, Math.floor(px / this.tileW))),
      y: Math.max(0, Math.min(this.rows - 1, Math.floor((py - footEpsilon) / this.tileH))),
    };
  }

  tileToPixel(tx, ty) {
    let x = tx * this.tileW + this.tileW / 2;
    let y = ty * this.tileH + this.tileH - this.footInsetY;

    const leftBlocked = this._isBlockedInRawGrid(tx - 1, ty);
    const rightBlocked = this._isBlockedInRawGrid(tx + 1, ty);
    const downBlocked = this._isBlockedInRawGrid(tx, ty + 1);

    if (leftBlocked && !rightBlocked) x += this.footPaddingX;
    else if (rightBlocked && !leftBlocked) x -= this.footPaddingX;

    if (downBlocked) y -= this.footPaddingY;

    return { x, y };
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
