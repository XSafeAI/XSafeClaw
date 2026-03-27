import { useRef, useEffect, useState } from 'react';
import * as PIXI from 'pixi.js';
import { FW, FH, CHAR_BASE } from '../config/constants';
import { generateJourneyEvents } from '../data/mockData';

/**
 * Normalize backend events into the shape Journey expects.
 * Backend events use status "ok"/"error"/"running" while Journey
 * renders "completed"/"warning"/"error". Also ensures every event
 * has at least an event_id, event_type, duration, and conversations.
 */
function normalizeEvents(rawEvents, agentId) {
  return rawEvents.map((e, i) => ({
    event_id: e.event_id || `real-${agentId}-${i}`,
    agent_id: e.agent_id || agentId,
    event_type: e.event_type || 'chat',
    status: e.status === 'ok' ? 'completed' : e.status,
    start_time: e.start_time || '',
    duration: e.duration ?? 0,
    conversations: (e.conversations || []).map((c) => ({
      role: c.role,
      text: c.text || c.content_text || '',
    })),
  }));
}

/* ── Configuration ── */
const CHAR_SCALE     = 1.35;       // smaller character
const WALK_SPEED     = 0.6;        // px per frame (slow)
const STAR_VARIANT_URLS = [
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/blue-star-18px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/cyan-star-18px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/green-star-18px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/orange-star-18px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/pink-star-18px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/purple-star-18px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/red-star-18px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/yellow-star-18px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/blue-star-36px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/cyan-star-36px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/green-star-36px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/orange-star-36px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/pink-star-36px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/purple-star-36px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/red-star-36px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/yellow-star-36px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/blue-star-72px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/cyan-star-72px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/green-star-72px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/orange-star-72px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/pink-star-72px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/purple-star-72px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/red-star-72px.png',
  '/emotes/stars/Pixel Star Badges.glitchedinorbit/yellow-star-72px.png',
];
const LASER_ALL_FRAMES = 24;
const LASER_ALL_DIR = '/beams/Laser (All States)';
const LASER_BASE_H    = 64;
const LASER_SPEED_START = 0.24;
const LASER_SPEED_END   = 0.28;
const LASER_ACTIVATE_DISTANCE = 90;
const LASER_SCALE_FACTOR = 0.72;
const LASER_ALPHA = 0.56;
const LASER_WIDTH_SCALE = 0.34;
const LASER_POP_ALPHA = 0.9;
const STAR_TARGET_MIN_PX = 30;
const STAR_TARGET_MAX_PX = 54;
const PORTAL_URL     = '/portals/4.png';
const GROUND_TILE_SETS = ['T1', 'T2'];
const BG_LAYER_MAX   = 16;
const SCENE_RATIO    = 2;          // keep Journey viewport at 2:1
const PORTAL_FW      = 64;
const PORTAL_FH      = 64;
const PORTAL_FRAMES  = 6;
const PORTAL_SCALE   = 1.5;

const BG_SCENE_CANDIDATES = [
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8',
  'Industry1', 'Industry2', 'Industry3', 'Industry4',
];

function shuffleCopy(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function layerSpeedByIndex(idx, total) {
  // idx starts from 0 => file 1.png has no movement.
  if (idx === 0) return 0;
  // Stronger parallax gap + faster top layer
  const t = idx / Math.max(1, total - 1);
  return 0.2 + Math.pow(t, 1.12) * 2.7;
}

function getSceneRect(vw, vh, ratio = SCENE_RATIO) {
  const viewportRatio = vw / Math.max(1, vh);
  // Strict 2:1 visible scene (contain inside viewport).
  if (viewportRatio >= ratio) {
    const h = vh;
    const w = h * ratio;
    return { x: Math.round((vw - w) / 2), y: 0, w: Math.round(w), h: Math.round(h) };
  }
  const w = vw;
  const h = w / ratio;
  return { x: 0, y: Math.round((vh - h) / 2), w: Math.round(w), h: Math.round(h) };
}

function fitSpriteToSceneHeight(sprite, sceneRect) {
  // No source crop: scale by scene height, preserve full image.
  const tw = sprite.texture?.width || sceneRect.w;
  const th = sprite.texture?.height || sceneRect.h;
  const scale = sceneRect.h / Math.max(1, th);
  sprite.width = Math.ceil(tw * scale);
  sprite.height = sceneRect.h;
  sprite.y = sceneRect.y;
}

/**
 * Agent Work Journey — the character walks slowly from left to right
 * across the screen. Backgrounds cycle with cross-fade behind them.
 * Stars mark past activities; the character stops at each to reveal
 * the conversation, then continues.
 *
 * Controls: scroll ↓ = go right, scroll ↑ = go left.
 */
export default function AgentJourney({ data, onClose }) {
  const canvasRef  = useRef(null);
  const pauseTimerRef = useRef(null);
  const convoCenterTimerRef = useRef(null);
  const showBadgeRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const finishRef = useRef(() => {});
  const stateRef   = useRef({
    direction: 1,       // 1 = right, -1 = left
    paused: false,
    active: false,
    finishing: false,
    charX: 0,
    visitedStars: new Set(),
  });

  const [activeEvt, setActiveEvt] = useState(null);   // { evt, pos: {x,y}, centered: bool }
  const [showBadge, setShowBadge] = useState(false);
  const [events] = useState(() => {
    let all;
    const real = data.events;
    if (real && real.length > 0) {
      all = normalizeEvents(real, data.agent?.id);
    } else {
      all = generateJourneyEvents(data.agent);
    }
    if (all.length <= 1) return all;
    const first = { ...all[0], _isFirst: true };
    const rest = all.slice(1);
    const JOURNEY_MAX = 10;
    let sampled;
    if (rest.length <= JOURNEY_MAX) {
      sampled = rest;
    } else {
      const indices = new Set();
      while (indices.size < JOURNEY_MAX) indices.add(Math.floor(Math.random() * rest.length));
      sampled = [...indices].sort((a, b) => a - b).map((i) => rest[i]);
    }
    return [first, ...sampled];
  });

  useEffect(() => {
    showBadgeRef.current = showBadge;
  }, [showBadge]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || events.length === 0) return;
    let disposed = false;

    const vw = el.clientWidth;
    const vh = el.clientHeight;
    let sceneRect = getSceneRect(vw, vh);

    PIXI.BaseTexture.defaultOptions.scaleMode = PIXI.SCALE_MODES.NEAREST;
    const app = new PIXI.Application({
      width: vw, height: vh,
      background: 0x1a1816,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    el.appendChild(app.view);
    app.view.style.width  = '100%';
    app.view.style.height = '100%';

    const st = stateRef.current;
    st.direction = 1;
    st.paused = false;
    st.active = false;
    st.finishing = false;
    st.visitedStars = new Set();

    /* ══════════════ Backgrounds (layered scrolling) ══════════════ */
    let bgLayers = []; // [{ sprites, tileW, speed }]
    let currentSceneName = '';
    const bgRoot = new PIXI.Container();
    bgRoot.zIndex = -200;
    bgRoot.sortableChildren = true;
    const bgStarLayer = new PIXI.Container();
      // Keep stars near the first bg layer: slightly above layer-1, below higher layers.
      bgStarLayer.zIndex = -99.9;
    bgStarLayer.sortableChildren = true;
    const sceneMask = new PIXI.Graphics();
    sceneMask.beginFill(0xffffff, 1);
    sceneMask.drawRect(sceneRect.x, sceneRect.y, sceneRect.w, sceneRect.h);
    sceneMask.endFill();
    bgRoot.mask = sceneMask;
    app.stage.addChild(bgRoot);
    bgRoot.addChild(bgStarLayer);
    app.stage.addChild(sceneMask);

    const loadSceneLayerTextures = async (sceneName) => {
      const textures = [];
      for (let i = 1; i <= BG_LAYER_MAX; i++) {
        const url = `/background/${sceneName}/${i}.png`;
        try {
          const tex = await PIXI.Assets.load(url);
          tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
          textures.push(tex);
        } catch (_) {}
      }

      // Fallback: allow legacy single-image backgrounds
      if (textures.length === 0) {
        try {
          const tex = await PIXI.Assets.load(`/background/${sceneName}.png`);
          tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
          textures.push(tex);
        } catch (_) {}
      }
      return textures;
    };

    const loadRandomLayeredBackground = async () => {
      const candidates = shuffleCopy(BG_SCENE_CANDIDATES);
      for (const name of candidates) {
        const textures = await loadSceneLayerTextures(name);
        if (textures.length === 0) continue;

        currentSceneName = name;
        const layerEntries = [];
        for (let i = 0; i < textures.length; i++) {
          const tex = textures[i];
          const probe = new PIXI.Sprite(tex);
          fitSpriteToSceneHeight(probe, sceneRect);
          const tileW = Math.max(1, probe.width);
          probe.destroy();

          // Fill the scene with enough repeated tiles + buffer on each side.
          const tileCount = Math.max(3, Math.ceil(sceneRect.w / tileW) + 3);
          const sprites = [];
          for (let t = 0; t < tileCount; t++) {
            const spr = new PIXI.Sprite(tex);
            fitSpriteToSceneHeight(spr, sceneRect);
            spr.x = sceneRect.x + (t - 1) * tileW;
            spr.zIndex = -100 + i; // larger index overlays upper layers
            bgRoot.addChild(spr);
            sprites.push(spr);
          }

          layerEntries.push({
            sprites,
            tileW,
            speed: layerSpeedByIndex(i, textures.length),
          });
        }
        return layerEntries;
      }
      return [];
    };

    /* ══════════════ Ground tiles (1-left, 2-fill, 3-right) ══════════════ */
    let groundTopY = sceneRect.y + sceneRect.h;
    const groundLayer = new PIXI.Container();
    groundLayer.zIndex = 80;
    let groundSetName = '';
    let groundTexLeft = null;
    let groundTexMid = null;
    let groundTexRight = null;

    const loadGroundTiles = async () => {
      const sets = shuffleCopy(GROUND_TILE_SETS);
      for (const setName of sets) {
        try {
          const [t1, t2, t3] = await Promise.all([
            PIXI.Assets.load(`/ground/${setName}/Tiles_01.png`),
            PIXI.Assets.load(`/ground/${setName}/Tiles_02.png`),
            PIXI.Assets.load(`/ground/${setName}/Tiles_03.png`),
          ]);
          t1.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
          t2.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
          t3.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
          groundSetName = setName;
          groundTexLeft = t1;
          groundTexMid = t2;
          groundTexRight = t3;
          return true;
        } catch (_) {}
      }
      return false;
    };

    const layoutGroundTiles = () => {
      if (!groundTexLeft || !groundTexMid || !groundTexRight) return;
      for (const child of groundLayer.removeChildren()) child.destroy();

      const tileH = Math.max(16, Math.round(sceneRect.h * 0.085));
      // Ground must stay at the very bottom edge of the 2:1 scene.
      groundTopY = sceneRect.y + sceneRect.h - tileH;
      const baseScale = tileH / Math.max(1, groundTexMid.height);
      let leftW = Math.max(1, Math.round(groundTexLeft.width * baseScale));
      let rightW = Math.max(1, Math.round(groundTexRight.width * baseScale));

      // Keep left+right always inside scene width.
      if (leftW + rightW >= sceneRect.w) {
        const edgeScale = sceneRect.w / Math.max(1, (groundTexLeft.width + groundTexRight.width));
        leftW = Math.max(1, Math.round(groundTexLeft.width * edgeScale));
        rightW = Math.max(1, sceneRect.w - leftW);
      }
      const midW = Math.max(0, sceneRect.w - leftW - rightW);

      const left = new PIXI.Sprite(groundTexLeft);
      left.width = leftW;
      left.height = tileH;
      left.x = sceneRect.x;
      left.y = groundTopY;
      groundLayer.addChild(left);

      if (midW > 0) {
        // Compute tile count by length, then evenly divide the row width (no crop).
        const baseMidW = Math.max(1, Math.round(groundTexMid.width * baseScale));
        const midCount = Math.max(1, Math.round(midW / baseMidW));
        const unitW = Math.floor(midW / midCount);
        let remainder = midW - unitW * midCount;
        let x = sceneRect.x + leftW;
        for (let i = 0; i < midCount; i++) {
          const segW = unitW + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder -= 1;
          const mid = new PIXI.Sprite(groundTexMid);
          mid.x = x;
          mid.y = groundTopY;
          mid.width = segW;
          mid.height = tileH;
          groundLayer.addChild(mid);
          x += segW;
        }
      }

      const right = new PIXI.Sprite(groundTexRight);
      right.width = rightW;
      right.height = tileH;
      right.x = sceneRect.x + sceneRect.w - rightW;
      right.y = groundTopY;
      groundLayer.addChild(right);
    };

    /* ══════════════ Stars (activities) ══════════════ */
    const starPositions = [];       // { x, y, evt, container }
    const margin = sceneRect.w * 0.08;
    const usableW = sceneRect.w - margin * 2;

    events.forEach((evt, i) => {
      const x = sceneRect.x + margin + (usableW / (events.length)) * (i + 0.5);
      // Move stars higher into the "sky" area while keeping vertical variation.
      const yRatio = 0.18 + ((i * 0.618) % 1) * 0.20;
      starPositions.push({ x, y: sceneRect.y + sceneRect.h * yRatio, evt, idx: i });
    });

    let starContainers = [];
    let starTextures = [];
    let laserStartFrames = [];
    let laserEndFrames = [];

    const loadLaserFrames = async () => {
      try {
        const allFrames = await Promise.all(
          Array.from({ length: LASER_ALL_FRAMES }, (_, i) =>
            PIXI.Assets.load(`${LASER_ALL_DIR}/laser_AS_${String(i + 1).padStart(2, '0')}.png`)
          )
        );
        const prepared = allFrames.map((tex) => {
          tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
          return tex;
        });
        // Use one full-state laser set: a pulsing loop + a short finish burst.
        laserStartFrames = prepared.slice(0, 14);
        laserEndFrames = prepared.slice(14);
      } catch (e) {
        laserStartFrames = [];
        laserEndFrames = [];
        console.warn('Journey: laser frames load fail', e);
      }
    };

    const loadStars = async () => {
      try {
        const texList = await Promise.all(
          STAR_VARIANT_URLS.map((url) =>
            PIXI.Assets.load(url).then((tex) => {
              tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
              return tex;
            })
          )
        );
        starTextures = texList.filter(Boolean);
      } catch (_) { return; }
      if (starTextures.length === 0) return;

      starPositions.forEach(({ x, y, evt, idx }) => {
        const c = new PIXI.Container();
        c.x = x;
        c.y = y;
        c.zIndex = 0;

        // Static random star sprite (no spin).
        const chosenTex = starTextures[Math.floor(Math.random() * starTextures.length)];
        const anim = new PIXI.Sprite(chosenTex);
        anim.anchor.set(0.5);
        const targetSize = STAR_TARGET_MIN_PX + Math.random() * (STAR_TARGET_MAX_PX - STAR_TARGET_MIN_PX);
        const baseSize = Math.max(1, chosenTex.width);
        const starScale = targetSize / baseSize;
        anim.scale.set(starScale);
        c.addChild(anim);

        // Laser now appears only when the character gets close.
        c.__laser = null;
        c.__laserTop = (targetSize * 0.5) + 1;
        c.__laserDone = false;
        c.__laserTriggered = false;
        c.__activated = false;
        c.__starScale = starScale;
        c.__starTargetScale = starScale;
        c.__starSizePx = targetSize;

        // Appear when the character gets close / triggers this point.
        anim.visible = false;

        // Label
        const isFirst = evt._isFirst;
        const labelText = isFirst ? '★ FIRST TASK' : (evt.event_type || 'task');
        const label = new PIXI.Text(labelText, {
          fontFamily: 'Press Start 2P',
          fontSize: isFirst ? 6 : 5,
          fill: isFirst ? 0xFFD580 : 0xFFE4A0,
          align: 'center',
          dropShadow: isFirst,
          dropShadowColor: 0x000000,
          dropShadowDistance: 1,
          dropShadowAlpha: isFirst ? 0.6 : 0,
        });
        label.anchor.set(0.5, 0);
        label.y = (targetSize * 0.5) + 4;
        label.alpha = isFirst ? 1 : 0.7;
        label.visible = false;
        c.addChild(label);

        bgStarLayer.addChild(c);
        starContainers.push({ container: c, x, y, evt, idx });
      });
    };

    const ensureLaserActive = (starObj) => {
      const c = starObj?.container;
      if (!c || c.__laserDone || c.__laser || laserStartFrames.length === 0) return;

      const beamTop = c.__laserTop ?? 10;
      const beamLen = Math.max(10, (groundTopY - starObj.y) - beamTop + 2);
      const starSizeRatio = (c.__starSizePx || 20) / 20;
      const beamScaleY = (beamLen / Math.max(1, LASER_BASE_H)) * LASER_SCALE_FACTOR * (0.9 + starSizeRatio * 0.32);
      const beamScaleX = LASER_WIDTH_SCALE * (0.88 + starSizeRatio * 0.28);

      const beam = new PIXI.AnimatedSprite(laserStartFrames);
      beam.anchor.set(0.5, 0);
      beam.x = 0;
      beam.y = beamTop;
      // Keep beam slender: width and length are controlled separately.
      beam.scale.set(beamScaleX, beamScaleY);
      beam.alpha = LASER_POP_ALPHA;
      beam.blendMode = PIXI.BLEND_MODES.SCREEN;
      beam.animationSpeed = LASER_SPEED_START;
      beam.loop = true;
      beam.play();
      c.addChild(beam);
      c.__laser = beam;

      // Star and label appear with the effect trigger.
      const starAnim = c.children[0];
      const starLabel = c.children[1];
      if (starAnim && !c.__activated) {
        starAnim.visible = true;
        starAnim.alpha = 1;
        const base = c.__starTargetScale || 1;
        starAnim.scale.set(base * 1.55);
      }
      if (starLabel) starLabel.visible = true;
      c.__activated = true;
    };

    /* ══════════════ Character ══════════════ */
    let charSprite = null;
    let framesRight = [];
    let framesLeft  = [];
    let framesIdle  = [];
    let portalFrames = [];
    let portalLayer = null;

    const loadPortalFrames = async () => {
      try {
        const tex = await PIXI.Assets.load(PORTAL_URL);
        tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
        portalFrames = [];
        for (let i = 0; i < PORTAL_FRAMES; i++) {
          portalFrames.push(new PIXI.Texture(
            tex.baseTexture,
            new PIXI.Rectangle(i * PORTAL_FW, 0, PORTAL_FW, PORTAL_FH)
          ));
        }
      } catch (e) {
        portalFrames = [];
        console.warn('Journey: portal load fail', e);
      }
    };

    const playPortal = (x, y) => new Promise((resolve) => {
      if (!portalFrames.length || !portalLayer || disposed || app.destroyed) {
        resolve();
        return;
      }
      const anim = new PIXI.AnimatedSprite(portalFrames);
      anim.anchor.set(0.5, 1);
      anim.scale.set(PORTAL_SCALE);
      anim.x = x;
      anim.y = y;
      anim.zIndex = 220;
      anim.loop = false;
      anim.animationSpeed = 0.22;
      anim.onComplete = () => {
        if (portalLayer && portalLayer.parent) portalLayer.removeChild(anim);
        anim.destroy();
        resolve();
      };
      portalLayer.addChild(anim);
      anim.play();
    });

    const loadChar = async () => {
      const charName = data.charName || 'Adam';
      const runUrl   = CHAR_BASE + charName + '_run_32x32.png';
      const idleUrl  = CHAR_BASE + charName + '_idle_anim_32x32.png';

      try {
        const [runTex, idleTex] = await Promise.all([
          PIXI.Assets.load(runUrl),
          PIXI.Assets.load(idleUrl),
        ]);
        runTex.baseTexture.scaleMode  = PIXI.SCALE_MODES.NEAREST;
        idleTex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;

        const cut = (bt, s, e) => {
          const a = [];
          for (let i = s; i < e; i++)
            a.push(new PIXI.Texture(bt, new PIXI.Rectangle(i * FW, 0, FW, FH)));
          return a;
        };

        framesRight = cut(runTex.baseTexture, 0, 6);
        framesLeft  = cut(runTex.baseTexture, 12, 18);
        framesIdle  = cut(idleTex.baseTexture, 18, 24);

        charSprite = new PIXI.AnimatedSprite(framesRight);
        charSprite.animationSpeed = 0.12;
        charSprite.anchor.set(0.5, 1);
        charSprite.scale.set(CHAR_SCALE);
        charSprite.y = groundTopY + 2;
        charSprite.x = sceneRect.x + margin * 0.5;
        charSprite.zIndex = 200;
        charSprite.visible = false;
        charSprite.play();
        app.stage.addChild(charSprite);

        st.charX = charSprite.x;
      } catch (e) {
        console.warn('Journey: char load fail', e);
      }
    };

    /* ══════════════ Setup & game loop ══════════════ */
    app.stage.sortableChildren = true;
    app.stage.addChild(groundLayer);
    portalLayer = new PIXI.Container();
    portalLayer.zIndex = 210;
    app.stage.addChild(portalLayer);

    const finishJourneyWithPortal = () => {
      if (st.finishing) return;
      st.finishing = true;
      st.paused = true;
      st.active = false;
      if (convoCenterTimerRef.current) {
        clearTimeout(convoCenterTimerRef.current);
        convoCenterTimerRef.current = null;
      }
      setActiveEvt(null);
      const px = charSprite ? charSprite.x : (sceneRect.x + sceneRect.w * 0.5);
      const py = charSprite ? charSprite.y : (groundTopY + 2);
      if (charSprite) charSprite.visible = false;
      playPortal(px, py).then(() => {
        if (disposed || app.destroyed) return;
        onCloseRef.current?.();
      });
    };
    finishRef.current = finishJourneyWithPortal;

    (async () => {
      // Load one random layered scene; each layer scrolls and loops forever.
      bgLayers = await loadRandomLayeredBackground();
      if (bgLayers.length === 0) {
        console.warn('Journey: no layered backgrounds found in /public/background');
      } else {
        console.log(`Journey scene: ${currentSceneName}, layers=${bgLayers.length}`);
      }

      const hasGround = await loadGroundTiles();
      if (hasGround) {
        layoutGroundTiles();
        console.log(`Journey ground set: ${groundSetName}`);
      } else {
        console.warn('Journey: no ground tile set found under /public/ground');
      }

      await loadLaserFrames();
      await Promise.all([loadStars(), loadChar(), loadPortalFrames()]);

      // Spawn effect: portal plays first, then agent appears.
      if (charSprite) {
        await playPortal(charSprite.x, charSprite.y);
        if (!disposed && !app.destroyed) {
          charSprite.visible = true;
          st.active = true;
        }
      }

      /* ── Game Loop ── */
      app.ticker.add((delta) => {
        if (!charSprite) return;

        // ── Layered background loop ──
        for (const layer of bgLayers) {
          if (!layer || layer.speed <= 0) continue;

          const shift = st.paused
            ? (layer.speed * delta * 0.12)
            : (layer.speed * delta * st.direction);
          for (const spr of layer.sprites) spr.x -= shift;

          // Recycle tiles for seamless loop with no visible gap.
          if (shift > 0) {
            let maxX = Math.max(...layer.sprites.map(s => s.x));
            for (const spr of layer.sprites) {
              if (spr.x + layer.tileW < sceneRect.x) {
                spr.x = maxX + layer.tileW;
                maxX = spr.x;
              }
            }
          } else if (shift < 0) {
            let minX = Math.min(...layer.sprites.map(s => s.x));
            for (const spr of layer.sprites) {
              if (spr.x > sceneRect.x + sceneRect.w) {
                spr.x = minX - layer.tileW;
                minX = spr.x;
              }
            }
          }
        }

        // ── Character movement ──
        if (st.active && !st.paused) {
          st.charX += WALK_SPEED * st.direction;
          // Clamp to screen
          st.charX = Math.max(
            sceneRect.x + margin * 0.3,
            Math.min(sceneRect.x + sceneRect.w - margin * 0.3, st.charX)
          );
          charSprite.x = st.charX;

          // Update direction animation
          const wantedFrames = st.direction > 0 ? framesRight : framesLeft;
          if (charSprite.textures !== wantedFrames && wantedFrames.length) {
            charSprite.textures = wantedFrames;
            charSprite.play();
          }
        }

        // ── Check proximity to stars ──
        for (const s of starContainers) {
          const dist = Math.abs(st.charX - s.x);
          if (dist < 30 && !st.visitedStars.has(s.idx)) {
            st.visitedStars.add(s.idx);

            // Pulse the star
            const starAnim = s.container.children[0];
            if (starAnim) {
              const base = s.container.__starTargetScale || 1;
              starAnim.scale.set(base * 1.35);
            }

            ensureLaserActive(s);
            const laser = s.container.__laser;
            if (laser && !s.container.__laserDone) {
              s.container.__laserDone = true;
              s.container.__laserTriggered = true;
              if (laserEndFrames.length > 0) {
                laser.textures = laserEndFrames;
                laser.loop = false;
                laser.animationSpeed = LASER_SPEED_END;
                laser.onComplete = () => {
                  if (laser.parent) laser.parent.removeChild(laser);
                  laser.destroy();
                  s.container.__laser = null;
                };
                laser.play();
              } else {
                if (laser.parent) laser.parent.removeChild(laser);
                laser.destroy();
                s.container.__laser = null;
              }
            }

            const bubbleX = s.x;
            const bubbleY = charSprite.y - FH * CHAR_SCALE - 10;
            setActiveEvt({ evt: s.evt, pos: { x: bubbleX, y: bubbleY }, centered: false });

            // Slide the info box from trigger point to center of the screen.
            if (convoCenterTimerRef.current) clearTimeout(convoCenterTimerRef.current);
            convoCenterTimerRef.current = setTimeout(() => {
              setActiveEvt((prev) => {
                if (!prev || prev.evt?.event_id !== s.evt?.event_id) return prev;
                return { ...prev, centered: true };
              });
            }, 120);

            // Keep moving while showing info; only keep bubble for a short period.
            if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
            const convoCount = (s.evt?.conversations || []).length;
            const showMs = convoCount > 0 ? Math.min(2600, 1200 + convoCount * 260) : 700;
            pauseTimerRef.current = setTimeout(() => {
              if (disposed || app.destroyed) return;
              if (convoCenterTimerRef.current) {
                clearTimeout(convoCenterTimerRef.current);
                convoCenterTimerRef.current = null;
              }
              setActiveEvt(null);
              if (starAnim) {
                const base = s.container.__starTargetScale || 1;
                starAnim.scale.set(base);
              }
            }, showMs);
            break;
          }
        }

        // ── Check if journey complete (reached right edge after all stars) ──
        if (
          st.active &&
          st.charX >= sceneRect.x + sceneRect.w - margin &&
          st.visitedStars.size >= events.length &&
          !st.paused
        ) {
          st.paused = true;
          if (framesIdle.length) {
            charSprite.textures = framesIdle;
            charSprite.play();
          }
          showBadgeRef.current = true;
          setShowBadge(true);
        }
      });
    })();

    /* ── Scroll handler (direction control) ── */
    const onWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY;
      if (Math.abs(delta) < 2) return;

      // Scroll down → right, scroll up → left
      st.direction = delta > 0 ? 1 : -1;

      // If paused at a star and user scrolls, resume
      if (st.paused && !showBadgeRef.current) {
        if (pauseTimerRef.current) {
          clearTimeout(pauseTimerRef.current);
          pauseTimerRef.current = null;
        }
        if (convoCenterTimerRef.current) {
          clearTimeout(convoCenterTimerRef.current);
          convoCenterTimerRef.current = null;
        }
        st.paused = false;
        setActiveEvt(null);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    /* ── Resize ── */
    const resizeObs = new ResizeObserver(() => {
      if (!app.renderer) return;
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) {
        app.renderer.resize(w, h);
        sceneRect = getSceneRect(w, h);
        sceneMask.clear();
        sceneMask.beginFill(0xffffff, 1);
        sceneMask.drawRect(sceneRect.x, sceneRect.y, sceneRect.w, sceneRect.h);
        sceneMask.endFill();
        layoutGroundTiles();
        if (charSprite) charSprite.y = groundTopY + 2;
        for (const layer of bgLayers) {
          if (!layer) continue;
          if (!layer.sprites || !layer.sprites.length) continue;
          for (const spr of layer.sprites) fitSpriteToSceneHeight(spr, sceneRect);
          layer.tileW = Math.max(1, layer.sprites[0].width);
          for (let i = 0; i < layer.sprites.length; i++) {
            layer.sprites[i].x = sceneRect.x + (i - 1) * layer.tileW;
          }
        }
        for (const s of starContainers) {
          if (!s.container.__laserDone && !s.container.__laserTriggered) {
            const sizeFactor = (s.container.__starSizePx || 20) / 20;
            const nearDistance = LASER_ACTIVATE_DISTANCE * (0.9 + sizeFactor * 0.35);
            const near = Math.abs(st.charX - s.x) < nearDistance;
            if (near) ensureLaserActive(s);
          }
          const starAnim = s.container.children[0];
          if (starAnim && s.container.__activated) {
            const target = s.container.__starTargetScale || 1;
            starAnim.scale.x += (target - starAnim.scale.x) * 0.16;
            starAnim.scale.y += (target - starAnim.scale.y) * 0.16;
          }
          const laser = s.container.__laser;
          if (!laser || s.container.__laserDone) continue;
          const beamTop = s.container.__laserTop ?? 10;
          const beamLen = Math.max(10, (groundTopY - s.y) - beamTop + 2);
          const starSizeRatio = (s.container.__starSizePx || 20) / 20;
          const beamScaleY = (beamLen / Math.max(1, LASER_BASE_H)) * LASER_SCALE_FACTOR * (0.9 + starSizeRatio * 0.32);
          const beamScaleX = LASER_WIDTH_SCALE * (0.88 + starSizeRatio * 0.28);
          laser.y = beamTop;
          laser.scale.set(beamScaleX, beamScaleY);
          laser.alpha += (LASER_ALPHA - laser.alpha) * 0.2;
        }
      }
    });
    resizeObs.observe(el);

    return () => {
      disposed = true;
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
      if (convoCenterTimerRef.current) {
        clearTimeout(convoCenterTimerRef.current);
        convoCenterTimerRef.current = null;
      }
      resizeObs.disconnect();
      el.removeEventListener('wheel', onWheel);
      app.destroy(true, { children: true, texture: true, baseTexture: true });
      finishRef.current = () => {};
    };
  }, [events, data.charName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute stats
  const totalToolCalls = events.reduce((n, e) =>
    n + (e.conversations || []).filter(c => c.role === 'tool').length, 0);
  const totalWarnings = events.filter(e => e.status === 'warning' || e.status === 'error').length;

  return (
    <div className="journey-overlay">
      <div className="journey-canvas" ref={canvasRef} />

      <button className="journey-close" onClick={() => {
        const st = stateRef.current;
        if (st.finishing) return;
        // Before entering main run, allow direct close.
        if (!st.active) onCloseRef.current?.();
        else finishRef.current();
      }}>×</button>

      <div className="journey-hint">
        <span>↑ Scroll to change direction ↓</span>
      </div>

      {/* Conversation panel */}
      {activeEvt && (() => {
        const evt = activeEvt.evt;
        const convos = evt?.conversations || [];
        const statusClass = evt?.status === 'completed' ? 'jc-status-ok'
          : evt?.status === 'error' ? 'jc-status-error'
          : evt?.status === 'warning' ? 'jc-status-warn'
          : 'jc-status-run';
        const userMsgs = convos.filter((c) => c.role === 'user').length;
        const assistMsgs = convos.filter((c) => c.role === 'assistant').length;
        const toolMsgs = convos.filter((c) => c.role === 'tool').length;
        return (
          <div
            className={`journey-convo journey-convo-bubble ${activeEvt.centered ? 'journey-convo-centered' : ''}`}
            key={evt?.event_id}
            style={{
              left: activeEvt.centered ? '50%' : `${Math.round(activeEvt.pos?.x || 0)}px`,
              top: activeEvt.centered ? '12%' : `${Math.round(activeEvt.pos?.y || 0)}px`,
            }}
          >
            <div className="journey-convo-head">
              <div className="jc-head-left">
                {evt?._isFirst ? <span className="jc-status-pill jc-status-first">★ FIRST TASK</span> : null}
                <span className={`jc-status-pill ${statusClass}`}>{evt?.status || 'event'}</span>
                <span className="journey-convo-type">{evt?.event_type}</span>
              </div>
              <div className="jc-head-right">
                {evt?.start_time ? <span className="jc-head-time">{new Date(evt.start_time).toLocaleTimeString()}</span> : null}
                {evt?.duration ? <span className="jc-head-dur">{Math.round(evt.duration)}s</span> : null}
              </div>
            </div>
            <div className="jc-meta-strip">
              <span className="jc-meta-chip">{convos.length} MSG</span>
              {userMsgs > 0 ? <span className="jc-meta-chip jc-meta-user">{userMsgs} USER</span> : null}
              {assistMsgs > 0 ? <span className="jc-meta-chip jc-meta-assist">{assistMsgs} ASSIST</span> : null}
              {toolMsgs > 0 ? <span className="jc-meta-chip jc-meta-tool">{toolMsgs} TOOL</span> : null}
            </div>
            <div className="journey-convo-body">
              {convos.map((c, i) => (
                <div key={i} className={`jc-msg jc-${c.role}`}>
                  <div className="jc-msg-head">
                    <span className="jc-role">{c.role}</span>
                    <span className="jc-msg-idx">#{i + 1}</span>
                  </div>
                  <p className="jc-text">{c.text}</p>
                </div>
              ))}
              {convos.length === 0 ? <div className="jc-empty">No conversation data recorded for this event.</div> : null}
            </div>
          </div>
        );
      })()}

      {/* Achievement badge */}
      {showBadge && (
        <div className="journey-badge-overlay">
          <div className="journey-badge">
            <div className="jb-title">★ JOURNEY COMPLETE ★</div>
            <div className="jb-stats">
              <div>Activities</div><span>{events.length}</span>
              <div>Tool Calls</div><span>{totalToolCalls}</span>
              <div>Warnings</div><span>{totalWarnings}</span>
            </div>
            <button className="btn primary" onClick={() => finishRef.current()}>Back to Agent Valley</button>
          </div>
        </div>
      )}
    </div>
  );
}
