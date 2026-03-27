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
  findPath(sx, sy, ex, ey, maxIter = 4000) {
    if (!this.isWalkable(sx, sy) || !this.isWalkable(ex, ey)) return null;
    if (sx === ex && sy === ey) return [{ x: sx, y: sy }];

    const cols = this.cols;
    const idx = (x, y) => y * cols + x;
    const heuristic = (ax, ay) => Math.abs(ax - ex) + Math.abs(ay - ey);
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

    const gScore = new Map();
    const parent = new Map();
    const closed = new Set();

    const heap = [];
    const push = (node) => {
      heap.push(node);
      let i = heap.length - 1;
      while (i > 0) {
        const pi = (i - 1) >> 1;
        if (heap[pi].f <= heap[i].f) break;
        [heap[pi], heap[i]] = [heap[i], heap[pi]];
        i = pi;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        while (true) {
          let s = i, l = 2 * i + 1, r = l + 1;
          if (l < heap.length && heap[l].f < heap[s].f) s = l;
          if (r < heap.length && heap[r].f < heap[s].f) s = r;
          if (s === i) break;
          [heap[i], heap[s]] = [heap[s], heap[i]];
          i = s;
        }
      }
      return top;
    };

    const si = idx(sx, sy);
    gScore.set(si, 0);
    push({ x: sx, y: sy, f: heuristic(sx, sy), i: si });

    let iterations = 0;
    while (heap.length > 0 && iterations++ < maxIter) {
      const cur = pop();
      if (cur.x === ex && cur.y === ey) {
        const path = [];
        let ci = idx(ex, ey);
        while (ci !== undefined) {
          const cx = ci % cols, cy = (ci / cols) | 0;
          path.push({ x: cx, y: cy });
          ci = parent.get(ci);
        }
        path.reverse();
        return this._simplifyPath(path);
      }

      if (closed.has(cur.i)) continue;
      closed.add(cur.i);
      const curG = gScore.get(cur.i) || 0;

      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx, ny = cur.y + dy;
        const ni = idx(nx, ny);
        if (closed.has(ni) || !this.isWalkable(nx, ny)) continue;

        const g = curG + 1;
        if (g < (gScore.get(ni) ?? Infinity)) {
          parent.set(ni, cur.i);
          gScore.set(ni, g);
          push({ x: nx, y: ny, f: g + heuristic(nx, ny), i: ni });
        }
      }
    }

    return null;
  }

  _simplifyPath(path) {
    if (path.length <= 2) return path;
    const result = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      const prev = result[result.length - 1];
      const next = path[i + 1];
      if ((path[i].x - prev.x) !== (next.x - path[i].x) ||
          (path[i].y - prev.y) !== (next.y - path[i].y)) {
        result.push(path[i]);
      }
    }
    result.push(path[path.length - 1]);
    return result;
  }

  /** Nearest walkable tile to (fx, fy) via BFS spiral. */
  getNearestWalkable(fx, fy) {
    if (this.isWalkable(fx, fy)) return { x: fx, y: fy };
    const visited = new Set();
    const queue = [{ x: fx, y: fy }];
    visited.add(`${fx},${fy}`);
    while (queue.length) {
      const { x, y } = queue.shift();
      for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
        const nx = x + dx, ny = y + dy;
        const k = `${nx},${ny}`;
        if (visited.has(k)) continue;
        visited.add(k);
        if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows) continue;
        if (this.grid[ny][nx] === 0) return { x: nx, y: ny };
        queue.push({ x: nx, y: ny });
      }
    }
    return this.getRandomWalkable();
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
