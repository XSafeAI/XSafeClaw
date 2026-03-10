import * as PIXI from 'pixi.js';

/**
 * Loads a Tiled JSON export, renders tile layers into a PIXI.Container,
 * and extracts the collision grid + workstation objects.
 */
export default class TiledRenderer {
  constructor(mapData) {
    this.data   = mapData;
    this.tileW  = mapData.tilewidth;
    this.tileH  = mapData.tileheight;
    this.mapW   = mapData.width;
    this.mapH   = mapData.height;
    this.pixelW = this.mapW * this.tileW;
    this.pixelH = this.mapH * this.tileH;
    this.tilesets  = [];
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
  }

  /**
   * Load all tileset images referenced by the map.
   * Handles both embedded tilesets and external .tsj references.
   */
  async loadTilesets(basePath, mapUrl) {
    const mapDir = mapUrl
      ? mapUrl.substring(0, mapUrl.lastIndexOf('/') + 1)
      : (basePath + '/');

    for (const tsEntry of this.data.tilesets) {
      let tsData = tsEntry;

      // External tileset: { firstgid, source: "map_assets/office_map.tsj" }
      if (tsEntry.source && !tsEntry.image) {
        const tsjUrl = mapDir + tsEntry.source;
        try {
          const res  = await fetch(tsjUrl);
          const ext  = await res.json();
          tsData = { ...ext, firstgid: tsEntry.firstgid };
          const tsjDir = tsjUrl.substring(0, tsjUrl.lastIndexOf('/') + 1);
          tsData._imgBase = tsjDir;
        } catch (e) {
          console.warn('TiledRenderer: failed to load external tileset', tsjUrl, e);
          continue;
        }
      }

      const imgBase = tsData._imgBase || (basePath + '/');
      const imgPath = imgBase + tsData.image;

      try {
        const tex = await PIXI.Assets.load(imgPath);
        tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
        const tw   = tsData.tilewidth  || this.tileW;
        const th   = tsData.tileheight || this.tileH;
        const cols = tsData.columns || Math.floor(tsData.imagewidth / tw);
        this.tilesets.push({
          ...tsData,
          tilewidth: tw,
          tileheight: th,
          texture: tex,
          cols,
        });
      } catch (e) {
        console.warn('TiledRenderer: failed to load tileset image', imgPath, e);
      }
    }
    this.tilesets.sort((a, b) => b.firstgid - a.firstgid);
  }

  /** Resolve a global tile ID to tileset info (handles Tiled flip flags). */
  _resolve(gid) {
    const FLIP_H = 0x80000000, FLIP_V = 0x40000000, FLIP_D = 0x20000000;
    const realGid = gid & ~(FLIP_H | FLIP_V | FLIP_D);
    for (const ts of this.tilesets) {
      if (realGid >= ts.firstgid) {
        const lid = realGid - ts.firstgid;
        return {
          ts,
          col: lid % ts.cols,
          row: Math.floor(lid / ts.cols),
          flipH: !!(gid & FLIP_H),
          flipV: !!(gid & FLIP_V),
        };
      }
    }
    return null;
  }

  /** Render all visible tile layers and return the root container. */
  render() {
    let zIdx = 0;
    for (const layer of this.data.layers) {
      if (layer.type !== 'tilelayer' || layer.visible === false) continue;
      if (layer.name.toLowerCase() === 'collision') continue;

      const lc = new PIXI.Container();
      lc.zIndex = zIdx++;

      for (let y = 0; y < layer.height; y++) {
        for (let x = 0; x < layer.width; x++) {
          const gid = layer.data[y * layer.width + x];
          if (gid === 0) continue;
          const r = this._resolve(gid);
          if (!r) continue;

          const rect = new PIXI.Rectangle(
            r.col * r.ts.tilewidth, r.row * r.ts.tileheight,
            r.ts.tilewidth, r.ts.tileheight
          );
          const tex    = new PIXI.Texture(r.ts.texture.baseTexture, rect);
          const sprite = new PIXI.Sprite(tex);
          sprite.x = x * this.tileW;
          sprite.y = y * this.tileH;
          if (r.flipH) { sprite.scale.x = -1; sprite.x += this.tileW; }
          if (r.flipV) { sprite.scale.y = -1; sprite.y += this.tileH; }
          lc.addChild(sprite);
        }
      }
      this.container.addChild(lc);
    }
    return this.container;
  }

  /** Extract collision grid: 0 = walkable, 1 = blocked. */
  getCollisionGrid() {
    const layer = this.data.layers.find(l =>
      l.type === 'tilelayer' && l.name.toLowerCase() === 'collision'
    );
    if (!layer) {
      console.warn('TiledRenderer: no "collision" layer — all tiles walkable.');
      return Array.from({ length: this.mapH }, () => Array(this.mapW).fill(0));
    }
    const grid = [];
    for (let y = 0; y < this.mapH; y++) {
      grid[y] = [];
      for (let x = 0; x < this.mapW; x++) {
        grid[y][x] = layer.data[y * this.mapW + x] !== 0 ? 1 : 0;
      }
    }
    return grid;
  }

  /** Extract workstation / spawn-point objects. */
  getWorkstations() {
    const layer = this.data.layers.find(l =>
      l.type === 'objectgroup' &&
      ['workstations', 'spawns', 'npc_spawns'].includes(l.name.toLowerCase())
    );
    if (!layer) return [];
    return layer.objects.map(obj => ({
      x: obj.x, y: obj.y,
      tileX: Math.floor(obj.x / this.tileW),
      tileY: Math.floor(obj.y / this.tileH),
      name: obj.name || 'spawn',
      properties: (obj.properties || []).reduce(
        (a, p) => { a[p.name] = p.value; return a; }, {}
      ),
    }));
  }

  /**
   * Detect building bounds and block outside tiles.
   * Returns { grid, rTop, rBot, cLeft, cRight }.
   */
  buildBoundedGrid() {
    const grid = this.getCollisionGrid();

    let rTop = 0, rBot = grid.length - 1;
    while (rTop < grid.length && grid[rTop].every(c => c === 0)) rTop++;
    while (rBot > rTop && grid[rBot].every(c => c === 0)) rBot--;

    let cLeft = 0, cRight = grid[0].length - 1;
    const colAllOpen = (col) => grid.every(row => row[col] === 0);
    while (cLeft < grid[0].length && colAllOpen(cLeft)) cLeft++;
    while (cRight > cLeft && colAllOpen(cRight)) cRight--;

    // Block tiles outside the building perimeter
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[0].length; x++) {
        if (y < rTop || y > rBot || x < cLeft || x > cRight) {
          grid[y][x] = 1;
        }
      }
    }

    return { grid, rTop, rBot, cLeft, cRight };
  }
}
