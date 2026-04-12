import { useEffect, useRef } from 'react';

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;

const mapCache = new Map();
const imageCache = new Map();

function resolveUrl(baseUrl, relativePath) {
  const normalizedBase = baseUrl.startsWith('http://') || baseUrl.startsWith('https://')
    ? baseUrl
    : new URL(baseUrl, window.location.origin).href;
  return new URL(relativePath, normalizedBase).href;
}

async function loadJson(url) {
  if (!mapCache.has(url)) {
    mapCache.set(url, fetch(url, { cache: 'no-store' }).then(async (res) => {
      if (!res.ok) throw new Error(`Failed to load map: ${url}`);
      return res.json();
    }));
  }
  return mapCache.get(url);
}

async function loadImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    }));
  }
  return imageCache.get(url);
}

async function loadTilesets(mapData, mapUrl) {
  const entries = await Promise.all((mapData.tilesets || []).map(async (entry) => {
    let tileset = entry;
    let baseUrl = mapUrl;

    if (entry.source && !entry.image) {
      const tsjUrl = resolveUrl(mapUrl, entry.source);
      const res = await fetch(tsjUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load tileset: ${tsjUrl}`);
      const external = await res.json();
      tileset = { ...external, firstgid: entry.firstgid };
      baseUrl = tsjUrl;
    }

    const imageUrl = resolveUrl(baseUrl, tileset.image);
    const image = await loadImage(imageUrl);
    const tilewidth = tileset.tilewidth || mapData.tilewidth;
    const tileheight = tileset.tileheight || mapData.tileheight;
    const columns = tileset.columns || Math.floor(tileset.imagewidth / tilewidth);

    return {
      ...tileset,
      image,
      tilewidth,
      tileheight,
      columns,
    };
  }));

  return entries.sort((a, b) => b.firstgid - a.firstgid);
}

function resolveTile(tilesets, gid) {
  const realGid = gid & ~(FLIP_H | FLIP_V | FLIP_D);
  for (const tileset of tilesets) {
    if (realGid >= tileset.firstgid) {
      const localId = realGid - tileset.firstgid;
      return {
        tileset,
        col: localId % tileset.columns,
        row: Math.floor(localId / tileset.columns),
        flipH: !!(gid & FLIP_H),
        flipV: !!(gid & FLIP_V),
      };
    }
  }
  return null;
}

function collectLayers(group, offsetX = 0, offsetY = 0) {
  const layers = [];
  for (const layer of group.layers || []) {
    const nextOffsetX = offsetX + (layer.offsetx || 0);
    const nextOffsetY = offsetY + (layer.offsety || 0);

    if (layer.type === 'group') {
      layers.push(...collectLayers(layer, nextOffsetX, nextOffsetY));
      continue;
    }

    if (layer.type === 'tilelayer' && layer.visible !== false) {
      layers.push({
        ...layer,
        _offsetX: nextOffsetX,
        _offsetY: nextOffsetY,
      });
    }
  }
  return layers;
}

function drawLayer(ctx, layer, mapData, tilesets) {
  const width = layer.width || mapData.width;
  const height = layer.height || mapData.height;
  const baseX = (layer.x || 0) + (layer._offsetX || 0);
  const baseY = (layer.y || 0) + (layer._offsetY || 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gid = layer.data?.[y * width + x] || 0;
      if (!gid) continue;

      const tile = resolveTile(tilesets, gid);
      if (!tile) continue;

      const { tileset, col, row, flipH, flipV } = tile;
      const sx = col * tileset.tilewidth;
      const sy = row * tileset.tileheight;
      const dx = baseX + x * mapData.tilewidth;
      const dy = baseY + y * mapData.tileheight;

      ctx.save();
      ctx.translate(dx + (flipH ? mapData.tilewidth : 0), dy + (flipV ? mapData.tileheight : 0));
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(
        tileset.image,
        sx,
        sy,
        tileset.tilewidth,
        tileset.tileheight,
        0,
        0,
        mapData.tilewidth,
        mapData.tileheight,
      );
      ctx.restore();
    }
  }
}

export default function TiledUiCanvas({
  mapUrl = '/UI/UI.tmj',
  groupName,
  className = '',
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function renderGroup() {
      try {
        const mapData = await loadJson(mapUrl);
        const tilesets = await loadTilesets(mapData, mapUrl);
        const group = (mapData.layers || []).find(
          (layer) => layer.type === 'group' && layer.name === groupName,
        );

        if (!group) {
          throw new Error(`Group not found in UI map: ${groupName}`);
        }

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        canvas.width = mapData.width * mapData.tilewidth;
        canvas.height = mapData.height * mapData.tileheight;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;

        const layers = collectLayers(group, 0, 0);
        for (const layer of layers) {
          drawLayer(ctx, layer, mapData, tilesets);
        }
      } catch (error) {
        console.warn('[TiledUiCanvas] render failed:', error);
      }
    }

    renderGroup();
    return () => {
      cancelled = true;
    };
  }, [groupName, mapUrl]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
