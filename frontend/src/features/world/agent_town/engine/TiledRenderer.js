import * as PIXI from 'pixi.js';

/**
 * Loads a Tiled JSON export, renders tile layers into a PIXI.Container,
 * and extracts the collision grid + workstation objects.
 */
export default class TiledRenderer {
  constructor(mapData, options = {}) {
    this.data   = mapData;
    this.options = options;
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

  _normalizeLayerName(name) {
    return String(name || '').trim().toLowerCase();
  }

  _isCollisionLayerName(name) {
    const layerName = this._normalizeLayerName(name);
    return layerName === 'collision' || layerName.startsWith('collision-');
  }

  _getRequestedVisualLayerName() {
    return this._normalizeLayerName(this.options.visualLayerName);
  }

  _getRequestedCollisionLayerName() {
    return this._normalizeLayerName(this.options.collisionLayerName);
  }

  _getRequestedTilesetName() {
    return this._normalizeLayerName(this.options.tilesetName);
  }

  _getRequestedImageAsset() {
    return String(this.options.imageAsset || '').trim();
  }

  _shouldRenderWholeImage() {
    return this.options.renderMode === 'whole-image';
  }

  _getRelevantContentLayers() {
    const requestedVisualLayerName = this._getRequestedVisualLayerName();
    const requestedCollisionLayerName = this._getRequestedCollisionLayerName();

    return this.data.layers.filter((layer) => {
      if (layer.type !== 'tilelayer') return false;
      const layerName = this._normalizeLayerName(layer.name);
      if (requestedVisualLayerName && layerName === requestedVisualLayerName) return true;
      if (requestedCollisionLayerName && layerName === requestedCollisionLayerName) return true;
      return false;
    });
  }

  _getLayerBounds(layer) {
    let top = Infinity;
    let bottom = -1;
    let left = Infinity;
    let right = -1;

    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        const gid = layer.data[y * layer.width + x];
        if (!gid) continue;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }

    if (bottom < top || right < left) return null;
    return { top, bottom, left, right };
  }

  getContentBounds() {
    if (this._contentBounds) return this._contentBounds;

    const layers = this._getRelevantContentLayers();
    let merged = null;

    for (const layer of layers) {
      const bounds = this._getLayerBounds(layer);
      if (!bounds) continue;
      if (!merged) {
        merged = { ...bounds };
      } else {
        merged.top = Math.min(merged.top, bounds.top);
        merged.bottom = Math.max(merged.bottom, bounds.bottom);
        merged.left = Math.min(merged.left, bounds.left);
        merged.right = Math.max(merged.right, bounds.right);
      }
    }

    if (!merged) {
      merged = {
        top: 0,
        bottom: this.mapH - 1,
        left: 0,
        right: this.mapW - 1,
      };
    }

    this._contentBounds = {
      ...merged,
      pixelX: merged.left * this.tileW,
      pixelY: merged.top * this.tileH,
      pixelW: (merged.right - merged.left + 1) * this.tileW,
      pixelH: (merged.bottom - merged.top + 1) * this.tileH,
    };
    return this._contentBounds;
  }

  _findWholeImageTileset() {
    const requestedTilesetName = this._getRequestedTilesetName();
    const requestedImageAsset = this._getRequestedImageAsset();

    return this.tilesets.find((tileset) => {
      const matchesName = requestedTilesetName
        ? this._normalizeLayerName(tileset.name) === requestedTilesetName
        : false;
      const matchesImage = requestedImageAsset
        ? requestedImageAsset.endsWith(`/${tileset.image}`) || requestedImageAsset === tileset.image
        : false;
      return matchesName || matchesImage;
    }) || null;
  }

  _renderWholeImageLayer() {
    const tileset = this._findWholeImageTileset();
    if (!tileset?.texture) return null;

    const sprite = new PIXI.Sprite(tileset.texture);
    sprite.x = 0;
    sprite.y = 0;
    sprite.zIndex = 0;
    sprite.eventMode = 'none';
    this.container.addChild(sprite);
    return this.container;
  }

  /**
   * Load all tileset images referenced by the map.
   * Handles both embedded tilesets and external .tsj references.
   */
  async loadTilesets(basePath, mapUrl) {
    const mapDir = mapUrl
      ? mapUrl.substring(0, mapUrl.lastIndexOf('/') + 1)
      : (basePath ? `${basePath}/` : '/');

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

      // Embedded tileset images should resolve relative to the TMJ file itself.
      const imgBase = tsData._imgBase || mapDir;
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
          flipD: !!(gid & FLIP_D),
        };
      }
    }
    return null;
  }

  /** Render all visible tile layers and return the root container. */
  render() {
    if (this._shouldRenderWholeImage()) {
      const wholeImage = this._renderWholeImageLayer();
      if (wholeImage) return wholeImage;
      console.warn('TiledRenderer: whole-image render requested but no matching tileset found, falling back to tile rendering.');
    }

    let zIdx = 0;
    const requestedVisualLayerName = this._getRequestedVisualLayerName();
    const hasRequestedVisualLayer = requestedVisualLayerName
      ? this.data.layers.some((layer) => (
          layer.type === 'tilelayer' &&
          this._normalizeLayerName(layer.name) === requestedVisualLayerName
        ))
      : false;

    for (const layer of this.data.layers) {
      if (layer.type !== 'tilelayer' || layer.visible === false) continue;
      if (this._isCollisionLayerName(layer.name)) continue;
      if (hasRequestedVisualLayer && this._normalizeLayerName(layer.name) !== requestedVisualLayerName) continue;

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
          const tex = new PIXI.Texture(r.ts.texture.baseTexture, rect);
          const sprite = new PIXI.Sprite(tex);

          if (r.flipD) {
            // Tiled diagonal flip is effectively a transpose; combine it with
            // horizontal/vertical flags using rotation around tile center.
            sprite.anchor.set(0.5);
            sprite.x = x * this.tileW + this.tileW / 2;
            sprite.y = y * this.tileH + this.tileH / 2;

            if (r.flipH && r.flipV) {
              sprite.rotation = Math.PI / 2;
              sprite.scale.x = -1;
            } else if (r.flipH) {
              sprite.rotation = Math.PI / 2;
            } else if (r.flipV) {
              sprite.rotation = -Math.PI / 2;
            } else {
              sprite.rotation = Math.PI / 2;
              sprite.scale.y = -1;
            }
          } else {
            sprite.x = x * this.tileW;
            sprite.y = y * this.tileH;
            if (r.flipH) { sprite.scale.x = -1; sprite.x += this.tileW; }
            if (r.flipV) { sprite.scale.y = -1; sprite.y += this.tileH; }
          }

          lc.addChild(sprite);
        }
      }
      this.container.addChild(lc);
    }
    return this.container;
  }

  /** Extract collision grid: 0 = walkable, 1 = blocked. */
  getCollisionGrid(layerName) {
    const requestedCollisionLayerName = this._normalizeLayerName(
      layerName || this.options.collisionLayerName
    );
    const layer = this.data.layers.find((l) => {
      if (l.type !== 'tilelayer') return false;
      const normalizedName = this._normalizeLayerName(l.name);
      if (requestedCollisionLayerName) return normalizedName === requestedCollisionLayerName;
      return this._isCollisionLayerName(normalizedName);
    });
    if (!layer) {
      console.warn('TiledRenderer: no collision layer found — all tiles walkable.');
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
  buildBoundedGrid(layerName) {
    const grid = this.getCollisionGrid(layerName);

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
