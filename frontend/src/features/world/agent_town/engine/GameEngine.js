import * as PIXI from 'pixi.js';
import PathFinder from './PathFinder';
import TiledRenderer from './TiledRenderer';
import SpriteLoader from './SpriteLoader';
import {
  FW, FH, NPC_SCALE, CHAR_NAMES, BG_COLOR,
  MAP_MODE, TILED_MAP_URL, TILED_BASE_PATH, DEFAULT_MAP_CONFIG,
  SCENE_IMAGE_URL, SCENE_W, SCENE_H,
  WALK_ZONES, MEETING_DIST, MEETING_TIME, MEETING_COOLDOWN, BUBBLE_MAX_CHARS,
  FIELD_NPC_DIALOGUE_URL,
  buildStableCharNameMap,
  hashAgentCharIndex,
  DEMO_MODE, DEMO_CHAR_NAME, isDemoSession,
} from '../config/constants';

const AGENT_PORTAL_URL = '/portals/2.png';
const GUARD_PORTAL_URL = '/portals/3.png';
const GUARD_IDLE_URL = '/guard/Idle.png';
const GUARD_WALK_URL = '/guard/Walk.png';
const GUARD_ATTACK_URL = '/guard/Attack.png';
const ISSUE_QUESTION_URL = '/UI/png/status/marks.png';
const GUARD_PORTAL_SCALE = 4.2;
const AGENT_PORTAL_SCALE = 3.8;
const AGENT_PORTAL_SPEED = 0.18;
const GUARD_BODY_SCALE = 3.6;
const GUARD_SHADOW_SCALE = 3.3;
const GUARD_BASE_SPEED_MIN = 0.72;
const GUARD_BASE_SPEED_VARIANCE = 0.18;
const GUARD_ESCORT_SPEED_MULTIPLIER = 8.0;
const GUARD_RETURN_SPEED_MULTIPLIER = 1.55;
const GUARD_WALK_ANIM_SPEED = 0.16;
const GUARD_ESCORT_ANIM_SPEED = 0.28;
const GUARD_RETURN_ANIM_SPEED = 0.22;
const GUARD_ESCORT_SIDE_OFFSET = 10 * NPC_SCALE + 10 * GUARD_SHADOW_SCALE + 8;
const GUARD_ESCORT_JITTER_X = 6;
const GUARD_ESCORT_JITTER_Y = 4;
const ISSUE_MARKER_SCALE = Math.max(0.5, NPC_SCALE * 0.2);
const ISSUE_MARKER_Y_OFFSET = 10;
const SHOW_EASTER_EGG_BUBBLE_MS = 3200;
const SHOW_EASTER_EGG_DOUBLE_TAP_MS = 320;
/** Same strip as pathfinding NPCs when moving right (`frames.right`); third frame = standing pose. */
const SHOW_NPC_RIGHT_STAND_FRAME = 2;
/** Default pixel offset from horizontal center of the map `npc` layer (negative = left). Layer bounds are approximate. */
const SHOW_NPC_DEFAULT_OFFSET_X = -56;
/** Readable monospace for dashboard metadata (subtitle, time axis); must match loaded webfont. */
const DASHBOARD_CODE_FONT_FAMILY = 'JetBrains Mono, Consolas, Menlo, monospace';
/** Wall dashboard left panel: extra carousel slot (photo + site id). */
const DASHBOARD_PROMO_AGENT_ID = 'dashboard-promo-xsafeclaw';
const DASHBOARD_PROMO_IMAGE_URL = '/sup/Ding.png';
const DASHBOARD_PROMO_DISPLAY_ID = 'www.xsafeclaw.ai';

/** Meeting pair speech bubbles — spaced apart, readable (long snippets). */
const MEETING_BUBBLE_FONT_SIZE = 20;
const MEETING_BUBBLE_LINE_HEIGHT = 30;
const MEETING_BUBBLE_PAD = 26;
const MEETING_BUBBLE_WORD_WRAP = 440;
const MEETING_BUBBLE_MIN_W = 300;
const MEETING_BUBBLE_MIN_H = 112;
const MEETING_BUBBLE_CORNER = 10;
const MEETING_BUBBLE_ANCHOR_Y = -FH * NPC_SCALE - 44;
const MEETING_BUBBLE_SPREAD_X = 84;
const MEETING_BUBBLE_STAGGER_Y = 22;
/** Short `response` line on field-NPC tap — smaller box than meeting. */
const FIELD_RESPONSE_BUBBLE_FONT_SIZE = 17;
const FIELD_RESPONSE_BUBBLE_LINE_HEIGHT = 26;
const FIELD_RESPONSE_BUBBLE_PAD = 20;
const FIELD_RESPONSE_BUBBLE_WORD_WRAP = 320;
const FIELD_RESPONSE_BUBBLE_MIN_W = 200;
const FIELD_RESPONSE_BUBBLE_MIN_H = 72;
const FIELD_RESPONSE_BUBBLE_CORNER = 10;
const FIELD_NPC_FLOAT_LABEL_MS = 4200;
/** Double-tap `filed_npc` narration — sized between meeting and response bubbles. */
const FIELD_NPC_FLOAT_OFFSET_Y = 58;
const FIELD_NPC_FLOAT_FONT_SIZE = 16;
const FIELD_NPC_FLOAT_LINE_HEIGHT = 24;
const FIELD_NPC_FLOAT_WORD_WRAP = 360;
const FIELD_NPC_FLOAT_PAD = 20;
const FIELD_NPC_FLOAT_CORNER = 10;
const FIELD_NPC_FLOAT_MIN_W = 168;
const FIELD_NPC_FLOAT_MIN_H = 72;

function getShowNpcStandTexture(frames, direction = 'right') {
  if (!frames) return null;
  const idleKey = direction === 'left' ? 'idleLeft'
    : direction === 'front' ? 'idleFront'
      : direction === 'back' ? 'idleBack'
        : 'idleRight';
  const runKey = direction === 'left' ? 'left'
    : direction === 'front' ? 'front'
      : direction === 'back' ? 'back'
        : 'right';
  return frames[idleKey]?.[SHOW_NPC_RIGHT_STAND_FRAME]
    || frames[runKey]?.[SHOW_NPC_RIGHT_STAND_FRAME]
    || frames.idleRight?.[SHOW_NPC_RIGHT_STAND_FRAME]
    || frames.right?.[SHOW_NPC_RIGHT_STAND_FRAME]
    || null;
}

/** Google Fonts CSS may still be loading when the engine starts; wait so @font-face exists before fonts.load(). */
async function waitForGoogleFontsStylesheet(timeoutMs = 2500) {
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter((l) =>
    /fonts\.googleapis\.com/.test(l.href)
  );
  if (!links.length) return;

  const waitOne = (link) =>
    new Promise((resolve) => {
      if (link.sheet) {
        resolve();
        return;
      }
      const done = () => resolve();
      link.addEventListener('load', done, { once: true });
      link.addEventListener('error', done, { once: true });
    });

  await Promise.race([
    Promise.all(links.map(waitOne)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * The core game engine — manages PixiJS app, map, NPCs, and game loop.
 * Framework-agnostic: React (or any UI) communicates via callbacks.
 */
export default class GameEngine {
  constructor(options = {}) {
    this.app          = null;
    this.world        = null;
    this.npcLayer     = null;
    this.pathfinder   = null;
    this.tiledRenderer = null;
    this.spriteLoader = new SpriteLoader();
    this.npcs         = [];
    this.overlayRects = {};
    this.floorScreen  = null;
    this.wallDashboard = null;
    this.showEasterEgg = null;
    this.creatorEasterEggs = [];
    this._mapOverlayContainer = null;
    this._floorScreenPreviewTexture = null;
    this._showEasterEggHideTimer = null;
    this._creatorEasterEggResponseTimer = null;
    this._creatorEasterEggResponseBubble = null;
    this.pendingNpc   = null;
    this.sceneW       = SCENE_W;
    this.sceneH       = SCENE_H;
    this._worldOffsetX = 0;
    this._worldOffsetY = 0;
    this._eventsByAgent = new Map();
    this._waitingAgents = new Set();
    this._agentsById = new Map();
    this._meetingCooldowns = new Map();
    this.guardLayer = null;
    this.guardFxLayer = null;
    this.guardUnits = [];
    this.guardEnabled = false;
    this._guardToken = 0;
    this._guardPortalFrames = [];
    this._guardPortalPoint = null;
    this._guardRecalling = false;
    this._guardPortalPlaying = false;
    this._guardIdleFrames = [];
    this._guardWalkFrames = [];
    this._guardAttackFrames = [];
    this._agentPortalFrames = [];
    this._issueQuestionTexture = null;
    this._guardPendingSnapshot = new Set();
    this.mapConfig = {
      ...DEFAULT_MAP_CONFIG,
      ...(options.mapConfig || {}),
    };
    this.sceneNpcDisplayMode = options.sceneNpcDisplayMode === 'capped' ? 'capped' : 'all';
    this.sceneNpcDisplayCap = Math.max(1, Math.floor(Number(options.sceneNpcDisplayCap) || 12));

    // Callbacks set by React component
    this.onNpcHover   = null;  // (npcData, globalPos) => void
    this.onNpcLeave   = null;  // () => void
    this.onNpcClick   = null;  // (agentData) => void
    this.onPendingClick = null; // () => void
    this.onCursorStateChange = null; // ('normal' | 'grab-start' | 'grab-full') => void
    this.onLayoutChange = null; // ({ sceneW, sceneH }) => void
    this._dragContext = null;
    this._dragCursorTimer = null;
    this._windowPointerMove = null;
    this._windowPointerUp = null;
    this._floorScreenInfoSignature = '';
    this._wallDashboardSignature = '';
    this._dashboardPromoTexture = null;
    this._fieldNpcDialogueHitLayer = null;
    /** @type {{ text?: string, response?: string }[] | null} */
    this._fieldDialogueLines = null;
    this._lastFieldNpcTapAt = 0;
    this._fieldDialogueToken = 0;
    this._fieldDialogueNpcTimer = null;
    this._fieldDialogueFloatTimer = null;
    this._fieldDialogueLockedNpc = null;
    this._fieldDialogueNpcSnap = null;
    this._fieldDialogueFloatBubble = null;
  }

  /** Initialize PixiJS application and attach to DOM element. */
  init(containerEl) {
    PIXI.BaseTexture.defaultOptions.scaleMode = PIXI.SCALE_MODES.NEAREST;

    this.app = new PIXI.Application({
      background: BG_COLOR,
      antialias: false,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    containerEl.appendChild(this.app.view);
    this.app.view.style.width  = '100%';
    this.app.view.style.height = '100%';
    this.app.view.style.touchAction = 'none';

    this.world = new PIXI.Container();
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.world);

    this.npcLayer = new PIXI.Container();
    this.npcLayer.sortableChildren = true;
    this.npcLayer.zIndex = 100;
    this.guardLayer = new PIXI.Container();
    this.guardLayer.sortableChildren = true;
    this.guardLayer.zIndex = 105;
    this.guardFxLayer = new PIXI.Container();
    this.guardFxLayer.sortableChildren = true;
    this.guardFxLayer.zIndex = 106;

    this._containerEl = containerEl;
    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(containerEl);
    this._windowPointerMove = (event) => this._handleWindowPointerMove(event);
    this._windowPointerUp = (event) => this._handleWindowPointerUp(event);
    window.addEventListener('pointermove', this._windowPointerMove);
    window.addEventListener('pointerup', this._windowPointerUp);
    window.addEventListener('pointercancel', this._windowPointerUp);
    window.addEventListener('blur', this._windowPointerUp);

    return this;
  }

  _resize() {
    if (!this.app) return;           // engine already destroyed
    const el = this._containerEl;
    const w = el.clientWidth, h = el.clientHeight;
    if (w < 1 || h < 1) return;
    this.app.renderer.resize(w, h);
    const scaleX = w / this.sceneW;
    const scaleY = h / this.sceneH;
    const scale  = Math.min(scaleX, scaleY);
    this.world.scale.set(scale);
    this.world.x = Math.round((w - this.sceneW * scale) / 2);
    this.world.y = Math.round((h - this.sceneH * scale) / 2);
    this.onLayoutChange?.({
      sceneW: this.sceneW,
      sceneH: this.sceneH,
      overlayRects: this.overlayRects,
    });
  }

  /** Load sprites + map. onProgress(0-1, label). */
  async loadAssets(onProgress) {
    // 1. Load sprite sheets
    onProgress?.(0, 'Loading sprites...');
    await this.spriteLoader.load((p) => onProgress?.(p * 0.5, 'Loading sprites...'));

    try {
      const promoTex = await PIXI.Assets.load(DASHBOARD_PROMO_IMAGE_URL);
      if (promoTex?.baseTexture) promoTex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
      this._dashboardPromoTexture = promoTex;
    } catch (_) {
      this._dashboardPromoTexture = null;
    }

    // 2. Wait for UI fonts (pixel + dashboard code style)
    await waitForGoogleFontsStylesheet();
    try { await document.fonts.load('8px "Press Start 2P"'); } catch (_) {}
    try {
      await document.fonts.load('400 12px "JetBrains Mono"');
      await document.fonts.load('500 14px "JetBrains Mono"');
      await document.fonts.load('500 15px "JetBrains Mono"');
      await document.fonts.load('500 16px "JetBrains Mono"');
      await document.fonts.load('500 18px "JetBrains Mono"');
      await document.fonts.load('600 14px "JetBrains Mono"');
    } catch (_) {}
    try {
      await document.fonts.ready;
    } catch (_) {}

    // 3. Load map
    onProgress?.(0.5, 'Loading map...');
    try {
      const dialogueUrl = this.mapConfig?.fieldNpcDialogueUrl || FIELD_NPC_DIALOGUE_URL;
      const dr = await fetch(dialogueUrl, { cache: 'no-store' });
      const raw = dr.ok ? await dr.json() : [];
      this._fieldDialogueLines = Array.isArray(raw) ? raw : [];
    } catch {
      this._fieldDialogueLines = [];
    }
    const mapUrl = this.mapConfig?.mapUrl || TILED_MAP_URL;
    if (MAP_MODE === 'tiled' && mapUrl) {
      try {
        const mapRes  = await fetch(mapUrl);
        const mapData = await mapRes.json();

        this.tiledRenderer = new TiledRenderer(mapData, {
          visualLayerName: this.mapConfig?.visualLayer,
          collisionLayerName: this.mapConfig?.collisionLayer,
          tilesetName: this.mapConfig?.tilesetName,
          imageAsset: this.mapConfig?.imageAsset,
          renderMode: this.mapConfig?.renderMode,
        });
        await this.tiledRenderer.loadTilesets(TILED_BASE_PATH, mapUrl);
        this._floorScreenPreviewTexture = null;
        const screenPreviewAsset = this.mapConfig?.screenPreviewImage || this.mapConfig?.previewImage || '';
        if (screenPreviewAsset) {
          try {
            this._floorScreenPreviewTexture = await PIXI.Assets.load(screenPreviewAsset);
            this._floorScreenPreviewTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
          } catch (_) {
            this._floorScreenPreviewTexture = null;
          }
        }
        const contentBounds = this.tiledRenderer.getContentBounds();
        const screenBounds = this.mapConfig?.screenLayerName
          ? this.tiledRenderer.getNamedLayerPixelBounds(this.mapConfig.screenLayerName)
          : null;
        const dashboardRegions = this.mapConfig?.dashboardLayerName
          ? this.tiledRenderer.getNamedLayerPixelRegions(this.mapConfig.dashboardLayerName)
          : [];
        const showBounds = this.mapConfig?.showLayerName
          ? this.tiledRenderer.getNamedLayerPixelBounds(this.mapConfig.showLayerName)
          : null;

        this.sceneW = contentBounds.pixelW;
        this.sceneH = contentBounds.pixelH;
        this._worldOffsetX = -contentBounds.pixelX;
        this._worldOffsetY = -contentBounds.pixelY;
        this._guardPortalPoint = null;
        this.overlayRects = {
          ...(screenBounds ? {
            screen: {
              x: screenBounds.pixelX - contentBounds.pixelX,
              y: screenBounds.pixelY - contentBounds.pixelY,
              w: screenBounds.pixelW,
              h: screenBounds.pixelH,
            },
          } : {}),
          ...(dashboardRegions.length ? {
            dashboardPanels: dashboardRegions.map((region) => ({
              x: region.pixelX - contentBounds.pixelX,
              y: region.pixelY - contentBounds.pixelY,
              w: region.pixelW,
              h: region.pixelH,
              tileCount: region.tileCount,
            })),
          } : {}),
          ...(showBounds ? {
            show: {
              x: showBounds.pixelX - contentBounds.pixelX,
              y: showBounds.pixelY - contentBounds.pixelY,
              w: showBounds.pixelW,
              h: showBounds.pixelH,
            },
          } : {}),
        };

        const mapContainer = this.tiledRenderer.render();
        this.world.addChild(mapContainer);

        // Keep pathfinding bounded, but render the full map the artist exported.
        const { grid } = this.tiledRenderer.buildBoundedGrid(this.mapConfig?.collisionLayer);
        this.pathfinder = new PathFinder(grid, this.tiledRenderer.tileW, this.tiledRenderer.tileH);

        mapContainer.x = this._worldOffsetX;
        mapContainer.y = this._worldOffsetY;
        this.npcLayer.x = this._worldOffsetX;
        this.npcLayer.y = this._worldOffsetY;
        this._setupFieldNpcDialogueLayer();
        this.guardLayer.x = this._worldOffsetX;
        this.guardLayer.y = this._worldOffsetY;
        this.guardFxLayer.x = this._worldOffsetX;
        this.guardFxLayer.y = this._worldOffsetY;
        this._createFloorScreenOverlay(this.overlayRects.screen || null);
        this._createWallDashboardOverlay(this.overlayRects.dashboardPanels || []);
        this._createShowEasterEggOverlay(this.overlayRects.show || null);
        await this._createCreatorEasterEggOverlay();

        if (this.mapConfig?.overlayLayerName) {
          const olc = this.tiledRenderer.renderOverlayLayer(this.mapConfig.overlayLayerName);
          if (olc) {
            olc.x = this._worldOffsetX;
            olc.y = this._worldOffsetY;
            olc.zIndex = 200;
            olc.eventMode = 'none';
            this._mapOverlayContainer = olc;
          }
        }

        console.log(
          `Map loaded: ${this.tiledRenderer.mapW}×${this.tiledRenderer.mapH} tiles, ` +
          `walkable: ${this.pathfinder._walkable.length}, scene: ${this.sceneW}×${this.sceneH}, ` +
          `layer: ${this.mapConfig?.visualLayer || 'all'}, bounds: ${contentBounds.left},${contentBounds.top} -> ${contentBounds.right},${contentBounds.bottom}`
        );
      } catch (e) {
        console.error('Failed to load Tiled map, falling back to static:', e);
      }
    }

    // Fallback: static image
    if (!this.tiledRenderer) {
      this._destroyFloorScreenOverlay();
      this._destroyWallDashboardOverlay();
      this._destroyShowEasterEggOverlay();
      this._destroyCreatorEasterEggOverlay();
      try {
        const bgTex = await PIXI.Assets.load(SCENE_IMAGE_URL);
        bgTex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
        const bg = new PIXI.Sprite(bgTex);
        bg.zIndex = 0;
        this.world.addChild(bg);
      } catch (_) {}
      this.sceneW = SCENE_W;
      this.sceneH = SCENE_H;
    }

    this.world.addChild(this.npcLayer);
    this.world.addChild(this.guardLayer);
    this.world.addChild(this.guardFxLayer);
    if (this._mapOverlayContainer) {
      this.world.addChild(this._mapOverlayContainer);
    }
    await this._loadGuardAssets();
    this._resize();
    onProgress?.(1, 'Ready');
  }

  getMapScreenTelemetry() {
    const offsetX = this._worldOffsetX || 0;
    const offsetY = this._worldOffsetY || 0;
    const agentSummary = this._summarizeFloorScreenAgents();
    const taskSummary = this._summarizeFloorScreenTasks();
    const npcMarkers = this.npcs
      .filter((npc) => npc?.container && Number.isFinite(npc.container.x) && Number.isFinite(npc.container.y))
      .map((npc, index) => ({
        ...(npc.agent?.id ? {
          _rawStatus: String((this._agentsById.get(npc.agent.id) || npc.agent || {}).status || '').toLowerCase(),
        } : {}),
        id: npc.agent?.id || npc.charName || `npc-${index}`,
        x: npc.container.x + offsetX,
        y: npc.container.y + offsetY,
        kind: (() => {
          const latest = this._agentsById.get(npc.agent?.id) || npc.agent || {};
          const rawStatus = String(latest.status || '').toLowerCase();
          if (this._isPendingStatus(rawStatus)) return 'pending';
          return rawStatus === 'idle' ? 'idle' : 'active';
        })(),
      }));

    return {
      sceneW: this.sceneW,
      sceneH: this.sceneH,
      agentCount: agentSummary.total,
      workingCount: agentSummary.working,
      pendingCount: agentSummary.pending,
      offlineCount: agentSummary.offline,
      taskSummary,
      markers: npcMarkers,
    };
  }

  _destroyFloorScreenOverlay() {
    this._floorScreenInfoSignature = '';
    const container = this.floorScreen?.container;
    if (container) {
      container.parent?.removeChild(container);
      container.destroy({ children: true });
    }
    this.floorScreen = null;
  }

  _destroyWallDashboardOverlay() {
    this._wallDashboardSignature = '';
    const container = this.wallDashboard?.container;
    if (container) {
      container.parent?.removeChild(container);
      container.destroy({ children: true });
    }
    this.wallDashboard = null;
  }

  _destroyShowEasterEggOverlay() {
    if (this._showEasterEggHideTimer) {
      clearTimeout(this._showEasterEggHideTimer);
      this._showEasterEggHideTimer = null;
    }
    const container = this.showEasterEgg?.container;
    if (container) {
      container.parent?.removeChild(container);
      container.destroy({ children: true });
    }
    this.showEasterEgg = null;
  }

  _destroyCreatorEasterEggResponseBubble() {
    if (this._creatorEasterEggResponseBubble?.parent) {
      this._creatorEasterEggResponseBubble.parent.removeChild(this._creatorEasterEggResponseBubble);
    }
    this._creatorEasterEggResponseBubble?.destroy({ children: true });
    this._creatorEasterEggResponseBubble = null;
  }

  _destroyCreatorEasterEggOverlay() {
    if (this._creatorEasterEggResponseTimer) {
      clearTimeout(this._creatorEasterEggResponseTimer);
      this._creatorEasterEggResponseTimer = null;
    }
    this._destroyCreatorEasterEggResponseBubble();
    for (const egg of this.creatorEasterEggs || []) {
      const container = egg?.container;
      if (container) {
        container.parent?.removeChild(container);
        container.destroy({ children: true });
      }
    }
    this.creatorEasterEggs = [];
  }

  /**
   * Character for the map "npc" show layer: optional `mapConfig.showNpcCharName`,
   * else first on-field NPC (same roster as `_createNPC`), else first CHAR_NAMES with a valid right-run strip.
   */
  _resolveShowNpcCharName() {
    const pinned = this.mapConfig?.showNpcCharName;
    if (typeof pinned === 'string' && pinned.length) {
      const frames = this.spriteLoader.charFrames[pinned];
      if (getShowNpcStandTexture(frames, 'right')) return pinned;
    }
    const firstNpc = this.npcs?.find((n) => n?.charName);
    if (firstNpc?.charName) {
      const frames = this.spriteLoader.charFrames[firstNpc.charName];
      if (getShowNpcStandTexture(frames, 'right')) return firstNpc.charName;
    }
    const fallback = CHAR_NAMES.find((n) => {
      const frames = this.spriteLoader.charFrames[n];
      return Boolean(getShowNpcStandTexture(frames, 'right'));
    });
    return fallback || CHAR_NAMES[0];
  }

  _syncShowNpcSpriteFromScene() {
    if (!this.showEasterEgg?.sprite) return;
    const charName = this._resolveShowNpcCharName();
    const frames = this.spriteLoader.charFrames[charName];
    const tex = getShowNpcStandTexture(frames, this.showEasterEgg.facing || 'right');
    if (!tex) return;
    if (this.showEasterEgg.charName === charName && this.showEasterEgg.sprite.texture === tex) return;
    this.showEasterEgg.charName = charName;
    this.showEasterEgg.sprite.texture = tex;
    const sprite = this.showEasterEgg.sprite;
    const root = sprite.parent;
    if (root) {
      const spriteW = FW * NPC_SCALE;
      const spriteH = FH * NPC_SCALE;
      root.hitArea = new PIXI.Rectangle(
        sprite.x - 8,
        this.showEasterEgg.spriteBaseY - spriteH - 8,
        spriteW + 16,
        spriteH + 16,
      );
    }
    const g = this.showEasterEgg.shadow;
    if (g) {
      const spriteW = FW * NPC_SCALE;
      g.clear();
      g.beginFill(0x000000, 0.16);
      g.drawEllipse(
        Math.round(sprite.x + spriteW * 0.52),
        this.showEasterEgg.spriteBaseY - 2,
        Math.round(spriteW * 0.34),
        Math.round(spriteW * 0.12),
      );
      g.endFill();
    }
  }

  _createShowEasterEggOverlay(rect) {
    this._destroyShowEasterEggOverlay();
    const message = String(this.mapConfig?.showEasterEggMessage || '').trim();
    if (!rect?.w || !rect?.h || !this.world) return;

    const charName = this._resolveShowNpcCharName();
    const frames = this.spriteLoader.charFrames[charName];
    const standTex = getShowNpcStandTexture(frames, 'right');
    if (!standTex) return;

    const width = rect.w;
    const height = rect.h;
    const container = new PIXI.Container();
    container.x = rect.x;
    container.y = rect.y;
    container.zIndex = 38;
    container.sortableChildren = true;
    container.eventMode = 'passive';

    const root = new PIXI.Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    container.addChild(root);

    const scale = NPC_SCALE;
    const spriteW = FW * scale;
    const offX = Number.isFinite(this.mapConfig?.showNpcOffsetX)
      ? this.mapConfig.showNpcOffsetX
      : SHOW_NPC_DEFAULT_OFFSET_X;
    const offY = Number.isFinite(this.mapConfig?.showNpcOffsetY)
      ? this.mapConfig.showNpcOffsetY
      : 0;
    // Center in the layer rect, then nudge; do not clamp spriteX — small/approximate regions need negative x.
    const spriteX = Math.round(width * 0.5 - spriteW / 2) + offX;
    const spriteBaseY = height - Math.max(8, Math.round(height * 0.08)) + offY;

    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.12);
    shadow.drawEllipse(
      Math.round(spriteX + (FW * scale) / 2),
      spriteBaseY - 1,
      10 * NPC_SCALE,
      3 * NPC_SCALE,
    );
    shadow.endFill();
    root.addChild(shadow);

    const sprite = new PIXI.Sprite(standTex);
    sprite.anchor.set(0, 1);
    sprite.x = spriteX;
    sprite.y = spriteBaseY;
    sprite.scale.set(scale);
    sprite.roundPixels = true;
    root.addChild(sprite);

    root.hitArea = new PIXI.Rectangle(
      sprite.x - 8,
      sprite.y - sprite.height - 8,
      sprite.width + 16,
      sprite.height + 16,
    );

    let bubble = null;
    let bubbleBaseY = 0;
    let bubbleText = null;
    if (message) {
      bubbleText = new PIXI.Text(message, new PIXI.TextStyle({
        fontFamily: 'Press Start 2P',
        fontSize: FIELD_NPC_FLOAT_FONT_SIZE,
        fill: 0x3a3020,
        wordWrap: true,
        wordWrapWidth: FIELD_NPC_FLOAT_WORD_WRAP,
        lineHeight: FIELD_NPC_FLOAT_LINE_HEIGHT,
        align: 'center',
      }));
      bubbleText.roundPixels = true;

      const pad = FIELD_NPC_FLOAT_PAD;
      const bubbleW = Math.max(FIELD_NPC_FLOAT_MIN_W, Math.ceil(bubbleText.width + pad * 2));
      const bubbleH = Math.max(FIELD_NPC_FLOAT_MIN_H, Math.ceil(bubbleText.height + pad * 2));
      bubble = new PIXI.Container();
      bubble.visible = false;
      bubble.alpha = 0;
      bubble.eventMode = 'none';

      const bubbleBg = new PIXI.Graphics();
      bubbleBg.beginFill(0xFFFDF8, 0.95);
      bubbleBg.lineStyle(1, 0xB2773F, 0.55);
      bubbleBg.drawRoundedRect(0, 0, bubbleW, bubbleH, FIELD_NPC_FLOAT_CORNER);
      bubbleBg.endFill();
      bubbleBg.beginFill(0xFFFDF8, 0.95);
      bubbleBg.moveTo(24, bubbleH);
      bubbleBg.lineTo(13, bubbleH + 14);
      bubbleBg.lineTo(42, bubbleH);
      bubbleBg.endFill();
      bubble.addChild(bubbleBg);

      bubbleText.x = pad;
      bubbleText.y = pad;
      bubble.addChild(bubbleText);

      const spriteH = FH * NPC_SCALE;
      const bubbleBaseX = Math.round(sprite.x + FW * NPC_SCALE + 16);
      bubbleBaseY = Math.round(spriteBaseY - spriteH - bubbleH + 18);
      bubble.x = bubbleBaseX;
      bubble.y = bubbleBaseY;
      root.addChild(bubble);

      let lastTapAt = 0;
      root.on('pointertap', () => {
        const now = performance.now();
        if (now - lastTapAt <= SHOW_EASTER_EGG_DOUBLE_TAP_MS) {
          lastTapAt = 0;
          this._triggerShowEasterEggMessage();
          return;
        }
        lastTapAt = now;
      });
    }

    this.showEasterEgg = {
      container,
      sprite,
      spriteBaseY,
      shadow,
      shadowBaseAlpha: 0.12,
      bubble,
      bubbleText,
      bubbleBaseY,
      charName,
      frames,
      defaultTexture: standTex,
      defaultBubbleText: message,
      facing: 'right',
    };

    this.world.addChild(container);
    this._syncShowEasterEggOverlay(performance.now());
  }

  async _createCreatorEasterEggOverlay() {
    this._destroyCreatorEasterEggOverlay();
    if (!this.world || !this.tiledRenderer) return;

    const configs = Array.isArray(this.mapConfig?.creatorEasterEggs)
      ? this.mapConfig.creatorEasterEggs
      : [];
    if (!configs.length) return;

    const eggs = [];
    for (const config of configs) {
      const layerName = String(config?.layerName || '').trim();
      const idleImage = String(config?.idleImage || '').trim();
      const responseImage = String(config?.responseImage || '').trim();
      if (!layerName || !idleImage || !responseImage) continue;

      const rect = this.tiledRenderer.getNamedLayerPixelBounds(layerName);
      if (!rect?.pixelW || !rect?.pixelH) continue;

      const [idleTexture, responseTexture] = await Promise.all([
        PIXI.Assets.load(idleImage),
        PIXI.Assets.load(responseImage),
      ]);
      if (!idleTexture || !responseTexture) continue;

      idleTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
      responseTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;

      const container = new PIXI.Container();
      container.x = rect.pixelX;
      container.y = rect.pixelY;
      container.zIndex = 38;
      container.sortableChildren = true;
      container.eventMode = 'passive';

      const sprite = new PIXI.Sprite(idleTexture);
      sprite.anchor.set(0, 1);
      sprite.roundPixels = true;

      const scale = Math.min(
        rect.pixelW / Math.max(1, idleTexture.width),
        rect.pixelH / Math.max(1, idleTexture.height),
      );
      sprite.scale.set(scale);
      sprite.x = Math.round((rect.pixelW - idleTexture.width * scale) / 2);
      sprite.y = rect.pixelH;

      const shadow = new PIXI.Graphics();
      shadow.beginFill(0x000000, 0.12);
      shadow.drawEllipse(
        Math.round(rect.pixelW / 2),
        Math.round(rect.pixelH - 1),
        Math.max(8, Math.round((idleTexture.width * scale) * 0.18)),
        Math.max(3, Math.round((idleTexture.width * scale) * 0.06)),
      );
      shadow.endFill();

      container.addChild(shadow);
      container.addChild(sprite);
      this.world.addChild(container);

      eggs.push({
        layerName,
        config,
        rect,
        container,
        sprite,
        shadow,
        idleTexture,
        responseTexture,
        baseSpriteY: sprite.y,
        shadowBaseAlpha: 0.12,
      });
    }

    this.creatorEasterEggs = eggs;
    this._syncCreatorEasterEggOverlay(performance.now());
  }

  _triggerShowEasterEggMessage(targetX, targetY, textOverride) {
    if (!this.showEasterEgg?.bubble) return;
    if (this._showEasterEggHideTimer) clearTimeout(this._showEasterEggHideTimer);

    if (typeof targetX === 'number' && typeof targetY === 'number') {
      this._setShowNpcFacingTowardPoint(targetX, targetY);
    }

    if (typeof textOverride === 'string' && textOverride.length && this.showEasterEgg.bubbleText) {
      this.showEasterEgg.bubbleText.text = textOverride;
    }

    this.showEasterEgg.bubble.visible = true;
    this.showEasterEgg.bubble.alpha = 1;
    this.showEasterEgg.bubble.y = this.showEasterEgg.bubbleBaseY;

    this._showEasterEggHideTimer = window.setTimeout(() => {
      this._showEasterEggHideTimer = null;
      if (!this.showEasterEgg?.bubble) return;
      this.showEasterEgg.bubble.visible = false;
      this.showEasterEgg.bubble.alpha = 0;
      this.showEasterEgg.bubble.y = this.showEasterEgg.bubbleBaseY;
      if (this.showEasterEgg.bubbleText && this.showEasterEgg.defaultBubbleText) {
        this.showEasterEgg.bubbleText.text = this.showEasterEgg.defaultBubbleText;
      }
      if (this.showEasterEgg.defaultTexture) {
        this.showEasterEgg.sprite.texture = this.showEasterEgg.defaultTexture;
        this.showEasterEgg.facing = 'right';
      }
    }, SHOW_EASTER_EGG_BUBBLE_MS);
  }

  _resetCreatorEasterEggResponse() {
    if (this._creatorEasterEggResponseTimer) {
      clearTimeout(this._creatorEasterEggResponseTimer);
      this._creatorEasterEggResponseTimer = null;
    }
    this._destroyCreatorEasterEggResponseBubble();
    for (const egg of this.creatorEasterEggs || []) {
      if (egg?.sprite && egg.idleTexture) {
        egg.sprite.texture = egg.idleTexture;
      }
    }
  }

  _triggerCreatorEasterEggResponse(text) {
    const eggs = (this.creatorEasterEggs || []).filter((egg) => egg?.sprite && egg?.responseTexture);
    if (!eggs.length) return;

    this._resetCreatorEasterEggResponse();
    for (const egg of eggs) {
      egg.sprite.texture = egg.responseTexture;
    }

    const raw = String(text || '').trim();
    if (raw && this.world) {
      const bubble = new PIXI.Container();
      bubble.zIndex = 39;
      bubble.sortableChildren = false;
      bubble.eventMode = 'none';

      const bubbleText = new PIXI.Text(raw, new PIXI.TextStyle({
        fontFamily: 'Press Start 2P',
        fontSize: FIELD_RESPONSE_BUBBLE_FONT_SIZE,
        fill: 0x3a3020,
        wordWrap: true,
        wordWrapWidth: FIELD_RESPONSE_BUBBLE_WORD_WRAP,
        lineHeight: FIELD_RESPONSE_BUBBLE_LINE_HEIGHT,
        align: 'center',
      }));
      bubbleText.anchor.set(0.5, 1);
      bubbleText.roundPixels = true;

      const pad = FIELD_RESPONSE_BUBBLE_PAD;
      const bubbleW = Math.max(FIELD_RESPONSE_BUBBLE_MIN_W, Math.ceil(bubbleText.width + pad * 2));
      const bubbleH = Math.max(FIELD_RESPONSE_BUBBLE_MIN_H, Math.ceil(bubbleText.height + pad * 2));
      const bubbleBg = new PIXI.Graphics();
      bubbleBg.beginFill(0xFFFDF8, 0.95);
      bubbleBg.lineStyle(1, 0xB2773F, 0.55);
      bubbleBg.drawRoundedRect(-bubbleW / 2, -bubbleH, bubbleW, bubbleH, FIELD_RESPONSE_BUBBLE_CORNER);
      bubbleBg.endFill();
      bubbleBg.beginFill(0xFFFDF8, 0.95);
      bubbleBg.moveTo(-11, 0);
      bubbleBg.lineTo(0, 14);
      bubbleBg.lineTo(11, 0);
      bubbleBg.endFill();

      const left = Math.min(...eggs.map((egg) => egg.container.x));
      const right = Math.max(...eggs.map((egg) => egg.container.x + egg.rect.pixelW));
      const top = Math.min(...eggs.map((egg) => egg.container.y));
      bubble.x = Math.round((left + right) / 2);
      bubble.y = Math.round(top - 16);
      bubbleText.y = -pad;

      bubble.addChild(bubbleBg);
      bubble.addChild(bubbleText);
      this.world.addChild(bubble);
      this._creatorEasterEggResponseBubble = bubble;
    }

    this._creatorEasterEggResponseTimer = window.setTimeout(() => {
      this._creatorEasterEggResponseTimer = null;
      this._resetCreatorEasterEggResponse();
    }, SHOW_EASTER_EGG_BUBBLE_MS);
  }

  _getShowNpcFacingTexture(targetDir) {
    const ee = this.showEasterEgg;
    if (!ee?.frames) return null;
    return getShowNpcStandTexture(ee.frames, targetDir);
  }

  _setShowNpcFacingTowardPoint(mapX, mapY) {
    const ee = this.showEasterEgg;
    if (!ee?.sprite || !ee.container) return;
    const spriteWorldX = ee.container.x + ee.sprite.x + (FW * NPC_SCALE) / 2;
    const spriteWorldY = ee.container.y + ee.sprite.y - (FH * NPC_SCALE) / 2;
    const dx = mapX - spriteWorldX;
    const dy = mapY - spriteWorldY;
    let dir;
    if (Math.abs(dx) >= Math.abs(dy)) {
      dir = dx >= 0 ? 'right' : 'left';
    } else {
      dir = dy >= 0 ? 'front' : 'back';
    }
    const tex = this._getShowNpcFacingTexture(dir);
    if (tex) {
      ee.sprite.texture = tex;
      ee.facing = dir;
    }
  }

  _syncShowEasterEggOverlay(now = performance.now()) {
    if (!this.showEasterEgg) return;

    const floatOffset = Math.sin(now / 520) * 1.8;
    this.showEasterEgg.sprite.y = this.showEasterEgg.spriteBaseY + floatOffset;
    this.showEasterEgg.shadow.alpha = this.showEasterEgg.shadowBaseAlpha + Math.sin(now / 620) * 0.02;

    if (this.showEasterEgg.bubble?.visible) {
      this.showEasterEgg.bubble.y = this.showEasterEgg.bubbleBaseY + Math.sin(now / 460) * 1.2;
      this.showEasterEgg.bubble.alpha = 0.94 + Math.sin(now / 180) * 0.05;
    }
  }

  _syncCreatorEasterEggOverlay(now = performance.now()) {
    if (!this.creatorEasterEggs?.length) return;

    this.creatorEasterEggs.forEach((egg, index) => {
      if (!egg?.sprite || !egg?.shadow) return;
      const floatOffset = Math.sin(now / 620 + index * 0.9) * 1.6;
      egg.sprite.y = egg.baseSpriteY + floatOffset;
      egg.shadow.alpha = egg.shadowBaseAlpha + Math.sin(now / 760 + index * 0.7) * 0.02;
    });

    if (this._creatorEasterEggResponseBubble) {
      this._creatorEasterEggResponseBubble.alpha = 0.95 + Math.sin(now / 180) * 0.04;
    }
  }

  _summarizeFloorScreenAgents() {
    return (this._agents || []).reduce((summary, agent) => {
      if (!agent) return summary;
      summary.total += 1;
      if (this._isPendingApproval(agent)) {
        summary.pending += 1;
      } else if (this._isRunningStatus(agent.status)) {
        summary.working += 1;
      } else {
        summary.offline += 1;
      }
      return summary;
    }, {
      total: 0,
      working: 0,
      pending: 0,
      offline: 0,
    });
  }

  /**
   * Same buckets as TownConsole `mapToSummaryBucket` / `/api/events` dashboard rows.
   * Used for the floor TASK DASHBOARD; `pending` is not shown on that panel.
   */
  _mapEventToDashboardBucket(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'running') return 'running';
    if (s === 'pending') return 'pending';
    if (s === 'completed' || s === 'ok') return 'completed';
    if (s === 'error') return 'error';
    if (s === 'fail' || s === 'failed') return 'failed';
    return 'running';
  }

  _summarizeFloorScreenTasks() {
    return (this._events || []).reduce((summary, event) => {
      const bucket = this._mapEventToDashboardBucket(event?.status);
      if (bucket === 'pending') return summary;
      if (bucket === 'running') summary.running += 1;
      else if (bucket === 'completed') summary.completed += 1;
      else if (bucket === 'error') summary.error += 1;
      else if (bucket === 'failed') summary.failed += 1;
      return summary;
    }, {
      running: 0,
      completed: 0,
      error: 0,
      failed: 0,
    });
  }

  _getDashboardStatusMeta(agent) {
    const latest = this._agentsById.get(agent?.id) || agent || {};
    if (agent && this._isPendingApproval(agent)) {
      return {
        id: 'pending',
        label: 'PENDING',
        fill: 0xffd37a,
        glow: 0xffd37a,
        textFill: 0xffd37a,
        bgFill: 0xd19321,
        bgAlpha: 0.18,
        borderFill: 0xffd37a,
        borderAlpha: 0.14,
      };
    }
    if (this._isRunningStatus(latest.status)) {
      return {
        id: 'working',
        label: 'WORKING',
        fill: 0x8cb4ff,
        glow: 0x8cb4ff,
        textFill: 0x8cb4ff,
        bgFill: 0x2c7fff,
        bgAlpha: 0.18,
        borderFill: 0x8cb4ff,
        borderAlpha: 0.16,
      };
    }
    return {
      id: 'offline',
      label: 'OFFLINE',
      fill: 0x9eb4c8,
      glow: 0x6aa6ff,
      textFill: 0xa8bdd8,
      bgFill: 0x6aa6ff,
      bgAlpha: 0.08,
      borderFill: 0xb8dcff,
      borderAlpha: 0.12,
    };
  }

  _truncateDashboardText(value, maxLength = 56) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLength
      ? `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
      : text;
  }

  _formatDashboardTime(value) {
    if (!value) return '--:--';
    try {
      return new Date(value).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return '--:--';
    }
  }

  _shortDashboardAgentId(value, maxLength = 10) {
    const raw = String(value || '')
      .replace(/^agent:main:/, '')
      .replace(/^chat-/, '')
      .trim();
    if (!raw) return 'AGENT';
    if (raw.length <= maxLength) return raw.toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(-4)}`.toUpperCase();
  }

  _pickDashboardShowcaseMode(seed) {
    let hash = 0;
    const text = String(seed || '');
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) % 9973;
    }
    return hash % 3 === 0 ? 'phone' : 'run';
  }

  _getAgentCharNameMap(agents = this._agents || []) {
    const { map } = buildStableCharNameMap(agents);
    if (DEMO_MODE) {
      for (const a of agents) {
        if (isDemoSession(a?.session_key) || isDemoSession(a?.id)) map[a.id] = DEMO_CHAR_NAME;
      }
    }
    return map;
  }

  _getDashboardSafeRect(
    rect,
    {
      leftRatio = 0.09,
      rightRatio = 0.09,
      topRatio = 0.16,
      bottomRatio = 0.22,
      minLeft = 18,
      minRight = 18,
      minTop = 16,
      minBottom = 18,
    } = {}
  ) {
    const insetLeft = Math.max(minLeft, Math.round(rect.w * leftRatio));
    const insetRight = Math.max(minRight, Math.round(rect.w * rightRatio));
    const insetTop = Math.max(minTop, Math.round(rect.h * topRatio));
    const insetBottom = Math.max(minBottom, Math.round(rect.h * bottomRatio));
    return {
      x: rect.x + insetLeft,
      y: rect.y + insetTop,
      w: Math.max(96, rect.w - insetLeft - insetRight),
      h: Math.max(72, rect.h - insetTop - insetBottom),
    };
  }

  _getDashboardPromoEntry() {
    return {
      id: DASHBOARD_PROMO_AGENT_ID,
      name: DASHBOARD_PROMO_DISPLAY_ID,
      idLabel: DASHBOARD_PROMO_DISPLAY_ID,
      charName: null,
      isDashboardPromo: true,
      statusMeta: {
        id: 'promo',
        label: 'XSAFECLAW',
        fill: 0x9edfff,
        glow: 0x6aa6ff,
        textFill: 0xa8dcff,
        bgFill: 0x4a7fff,
        bgAlpha: 0.2,
        borderFill: 0xb8dcff,
        borderAlpha: 0.22,
      },
      lastActiveAt: '',
    };
  }

  _getDashboardAgentEntries() {
    const priority = { pending: 3, working: 2, offline: 1 };
    const charNameMap = this._getAgentCharNameMap(this._agents || []);

    const sorted = (this._agents || [])
      .map((agent, index) => {
        const latest = this._agentsById.get(agent?.id) || agent || {};
        const latestEvent = this._getLatestEvent(agent) || null;
        const statusMeta = this._getDashboardStatusMeta(agent);
        const agentId = agent?.id || `agent-${index}`;

        return {
          id: agentId,
          name: latest.name || agent?.name || `Agent ${index + 1}`,
          idLabel: this._shortDashboardAgentId(latest?.session_key || latest?.id || agentId, 18),
          charName: charNameMap[agentId] || CHAR_NAMES[index % Math.max(1, CHAR_NAMES.length)],
          statusMeta,
          lastActiveAt: latestEvent?.start_time || latest.first_seen_at || '',
        };
      })
      .sort((a, b) => {
        const priorityDiff = (priority[b.statusMeta.id] || 0) - (priority[a.statusMeta.id] || 0);
        if (priorityDiff) return priorityDiff;
        return new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime();
      });

    return [...sorted, this._getDashboardPromoEntry()];
  }

  _getDashboard24hActivity(nowMs = Date.now()) {
    const hourMs = 60 * 60 * 1000;
    const buckets = Array.from({ length: 24 }, (_, index) => ({
      index,
      running: 0,
      pending: 0,
      completed: 0,
      error: 0,
      failed: 0,
      total: 0,
    }));
    const totals = {
      running: 0,
      pending: 0,
      completed: 0,
      error: 0,
      failed: 0,
    };

    for (const event of this._events || []) {
      const timeValue = event?.start_time || event?.created_at || event?.updated_at || event?.end_time;
      const timeMs = timeValue ? new Date(timeValue).getTime() : NaN;
      if (!Number.isFinite(timeMs)) continue;

      const diffHours = Math.floor((nowMs - timeMs) / hourMs);
      if (diffHours < 0 || diffHours >= 24) continue;

      const bucketIndex = 23 - diffHours;
      const key = this._mapEventToDashboardBucket(event?.status);
      buckets[bucketIndex][key] += 1;
      buckets[bucketIndex].total += 1;
      totals[key] += 1;
    }

    return {
      buckets,
      totals,
      maxTotal: Math.max(1, ...buckets.map((bucket) => bucket.total)),
    };
  }

  _drawSmoothDashboardCurve(graphics, points, baselineY, closePath = false) {
    if (!points.length) return;

    const first = points[0];
    if (closePath) {
      graphics.moveTo(first.x, baselineY);
      graphics.lineTo(first.x, first.y);
    } else {
      graphics.moveTo(first.x, first.y);
    }

    if (points.length === 1) {
      if (closePath) {
        graphics.lineTo(first.x, baselineY);
        graphics.lineTo(first.x, baselineY);
      }
      return;
    }

    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      graphics.quadraticCurveTo(current.x, current.y, midX, midY);
    }

    const prev = points[points.length - 2];
    const last = points[points.length - 1];
    graphics.quadraticCurveTo(prev.x, prev.y, last.x, last.y);

    if (closePath) {
      graphics.lineTo(last.x, baselineY);
      graphics.lineTo(first.x, baselineY);
    }
  }

  _createWallDashboardOverlay(panelRects = []) {
    this._destroyWallDashboardOverlay();
    if (!this.world || !Array.isArray(panelRects) || panelRects.length < 2) return;

    const sortedPanels = [...panelRects].sort((a, b) => a.x - b.x);
    const leftRect = this._getDashboardSafeRect(sortedPanels[0], {
      leftRatio: 0.06,
      rightRatio: 0.06,
      topRatio: 0.18,
      bottomRatio: 0.2,
      minLeft: 14,
      minRight: 14,
      minTop: 18,
      minBottom: 20,
    });
    const rightRect = this._getDashboardSafeRect(sortedPanels[1], {
      leftRatio: 0.045,
      rightRatio: 0.045,
      topRatio: 0.05,
      bottomRatio: 0.17,
      minLeft: 16,
      minRight: 16,
      minTop: 4,
      minBottom: 16,
    });
    const container = new PIXI.Container();
    container.zIndex = 44;
    container.sortableChildren = true;
    container.eventMode = 'none';

    const dashboardPalette = {
      shadow: 0x01060a,
      bgOuter: 0x08131a,
      bgInner: 0x0d1b23,
      border: 0x3a5f82,
      accent: 0x6aa6ff,
      accentAlt: 0x5e94e8,
      text: 0xe0efff,
      mutedText: 0xa0b8d8,
      chartGlow: 0x4ca8ff,
      chartLine: 0xc5e4ff,
      offlineTint: 0xa3b0c0,
    };

    const createPanelShell = (rect, accentFill = dashboardPalette.accent) => {
      const root = new PIXI.Container();
      root.x = rect.x;
      root.y = rect.y;
      root.eventMode = 'none';

      const shadow = new PIXI.Graphics();
      shadow.beginFill(dashboardPalette.shadow, 0.26);
      shadow.drawRect(4, 6, rect.w, rect.h);
      shadow.endFill();
      root.addChild(shadow);

      const board = new PIXI.Graphics();
      board.beginFill(dashboardPalette.bgOuter, 0.94);
      board.drawRect(0, 0, rect.w, rect.h);
      board.endFill();
      board.beginFill(dashboardPalette.bgInner, 0.97);
      board.drawRect(5, 5, Math.max(0, rect.w - 10), Math.max(0, rect.h - 10));
      board.endFill();
      board.beginFill(accentFill, 0.05);
      board.drawRect(0, 0, rect.w, Math.max(18, Math.round(rect.h * 0.16)));
      board.endFill();
      root.addChild(board);

      const rail = new PIXI.Graphics();
      rail.beginFill(accentFill, 0.28);
      rail.drawRect(0, 0, rect.w, 2);
      rail.endFill();
      root.addChild(rail);

      const footerRail = new PIXI.Graphics();
      footerRail.beginFill(accentFill, 0.14);
      footerRail.drawRect(0, rect.h - 2, rect.w, 2);
      footerRail.endFill();
      root.addChild(footerRail);

      const pixelGrid = new PIXI.Graphics();
      pixelGrid.lineStyle(1, accentFill, 0.04);
      const gridStep = Math.max(18, Math.round(Math.min(rect.w, rect.h) * 0.16));
      for (let x = 10; x < rect.w; x += gridStep) {
        pixelGrid.moveTo(x, 8);
        pixelGrid.lineTo(x, rect.h - 8);
      }
      for (let y = 10; y < rect.h; y += gridStep) {
        pixelGrid.moveTo(8, y);
        pixelGrid.lineTo(rect.w - 8, y);
      }
      root.addChild(pixelGrid);

      const scanlines = new PIXI.Graphics();
      scanlines.beginFill(accentFill, 0.018);
      for (let y = 4; y < rect.h; y += 6) {
        scanlines.drawRect(0, y, rect.w, 1);
      }
      scanlines.endFill();
      root.addChild(scanlines);

      const frame = new PIXI.Graphics();
      frame.lineStyle(1, dashboardPalette.border, 0.22);
      frame.drawRect(0.5, 0.5, Math.max(0, rect.w - 1), Math.max(0, rect.h - 1));
      frame.lineStyle(1, accentFill, 0.18);
      const cornerW = Math.max(18, Math.round(rect.w * 0.16));
      const cornerH = Math.max(10, Math.round(rect.h * 0.14));
      frame.moveTo(8, 8);
      frame.lineTo(8 + cornerW, 8);
      frame.moveTo(8, 8);
      frame.lineTo(8, 8 + cornerH);
      frame.moveTo(rect.w - 8, 8);
      frame.lineTo(rect.w - 8 - cornerW, 8);
      frame.moveTo(rect.w - 8, 8);
      frame.lineTo(rect.w - 8, 8 + cornerH);
      frame.moveTo(8, rect.h - 8);
      frame.lineTo(8 + cornerW, rect.h - 8);
      frame.moveTo(8, rect.h - 8);
      frame.lineTo(8, rect.h - 8 - cornerH);
      frame.moveTo(rect.w - 8, rect.h - 8);
      frame.lineTo(rect.w - 8 - cornerW, rect.h - 8);
      frame.moveTo(rect.w - 8, rect.h - 8);
      frame.lineTo(rect.w - 8, rect.h - 8 - cornerH);
      root.addChild(frame);

      const modules = new PIXI.Graphics();
      modules.beginFill(accentFill, 0.24);
      modules.drawRect(12, 10, Math.max(18, Math.round(rect.w * 0.16)), 4);
      modules.drawRect(12, 16, Math.max(10, Math.round(rect.w * 0.07)), 2);
      modules.drawRect(rect.w - Math.max(18, Math.round(rect.w * 0.15)) - 12, 10, Math.max(18, Math.round(rect.w * 0.15)), 4);
      modules.drawRect(rect.w - Math.max(12, Math.round(rect.w * 0.08)) - 12, rect.h - 14, Math.max(12, Math.round(rect.w * 0.08)), 2);
      modules.endFill();
      root.addChild(modules);

      const pixels = new PIXI.Graphics();
      pixels.beginFill(accentFill, 0.16);
      pixels.drawRect(12, rect.h - 16, 3, 3);
      pixels.drawRect(17, rect.h - 16, 3, 3);
      pixels.drawRect(rect.w - 20, 14, 3, 3);
      pixels.drawRect(rect.w - 15, 14, 3, 3);
      pixels.endFill();
      root.addChild(pixels);

      container.addChild(root);
      return root;
    };

    const leftRoot = createPanelShell(leftRect, dashboardPalette.accent);
    const rightRoot = createPanelShell(rightRect, dashboardPalette.accentAlt);

    const leftStatusBg = new PIXI.Graphics();
    leftRoot.addChild(leftStatusBg);

    const leftStatusText = new PIXI.Text('OFFLINE', new PIXI.TextStyle({
      fontFamily: 'Press Start 2P, monospace',
      fontSize: 13,
      fill: dashboardPalette.mutedText,
      letterSpacing: 0.7,
    }));
    leftStatusText.roundPixels = true;
    leftRoot.addChild(leftStatusText);

    const avatarAreaW = Math.max(108, Math.round(leftRect.w * 0.46));
    const avatarBaseY = leftRect.h - 16;
    const avatarGlow = new PIXI.Graphics();
    avatarGlow.beginFill(dashboardPalette.accent, 0.12);
    avatarGlow.drawEllipse(Math.round(avatarAreaW * 0.5), avatarBaseY - 2, Math.round(avatarAreaW * 0.28), 8);
    avatarGlow.endFill();
    leftRoot.addChild(avatarGlow);

    const defaultFrames = this.spriteLoader.charFrames[CHAR_NAMES[0]]?.idle || [PIXI.Texture.WHITE];
    const avatar = new PIXI.AnimatedSprite(defaultFrames.length ? defaultFrames : [PIXI.Texture.WHITE]);
    avatar.anchor.set(0.5, 1);
    avatar.x = Math.round(avatarAreaW * 0.5);
    avatar.y = avatarBaseY;
    avatar.scale.set(Math.max(1.9, Math.min(2.45, (leftRect.h * 0.9) / FH)));
    avatar.animationSpeed = 0.09;
    avatar.play();
    leftRoot.addChild(avatar);

    const promoAvatar = new PIXI.Sprite(this._dashboardPromoTexture || PIXI.Texture.WHITE);
    promoAvatar.visible = false;
    promoAvatar.anchor.set(0.5, 1);
    promoAvatar.x = Math.round(avatarAreaW * 0.5);
    promoAvatar.y = avatarBaseY;
    promoAvatar.roundPixels = true;
    leftRoot.addChild(promoAvatar);

    const textX = avatarAreaW + 10;
    const textW = Math.max(110, leftRect.w - textX - 10);

    const leftId = new PIXI.Text('AGENT', new PIXI.TextStyle({
      fontFamily: 'Arial, sans-serif',
      fontSize: 18,
      fill: dashboardPalette.text,
      fontWeight: '700',
      letterSpacing: 0.8,
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: textW,
    }));
    leftId.x = textX;
    leftId.y = 40;
    leftId.roundPixels = true;
    leftRoot.addChild(leftId);

    const rightHeader = new PIXI.Text('TASK ACTIVITY', new PIXI.TextStyle({
      fontFamily: 'Arial, sans-serif',
      fontSize: 26,
      fill: dashboardPalette.text,
      fontWeight: '700',
      letterSpacing: 1.1,
    }));
    rightHeader.x = 14;
    rightHeader.y = 6;
    rightHeader.roundPixels = true;
    rightRoot.addChild(rightHeader);

    const rightSub = new PIXI.Text('ALL TASKS · LAST 24H', new PIXI.TextStyle({
      fontFamily: DASHBOARD_CODE_FONT_FAMILY,
      fontSize: 15,
      fontWeight: '500',
      fill: dashboardPalette.mutedText,
      letterSpacing: 0.32,
    }));
    rightSub.x = 14;
    rightSub.y = 40;
    rightSub.roundPixels = true;
    rightRoot.addChild(rightSub);

    const chartTop = 54;
    const axisBottomReserve = 30;
    const chartRect = {
      x: 12,
      y: chartTop,
      w: Math.max(208, rightRect.w - 24),
      h: Math.max(48, rightRect.h - chartTop - axisBottomReserve),
    };

    const chartShell = new PIXI.Graphics();
    chartShell.lineStyle(1, dashboardPalette.border, 0.24);
    chartShell.drawRect(chartRect.x + 0.5, chartRect.y + 0.5, Math.max(0, chartRect.w - 1), Math.max(0, chartRect.h - 1));
    chartShell.beginFill(dashboardPalette.accent, 0.12);
    chartShell.drawRect(chartRect.x + 10, chartRect.y + 10, Math.max(12, Math.round(chartRect.w * 0.12)), 3);
    chartShell.drawRect(chartRect.x + 10, chartRect.y + 16, Math.max(8, Math.round(chartRect.w * 0.06)), 2);
    chartShell.endFill();
    rightRoot.addChild(chartShell);

    const chartGrid = new PIXI.Graphics();
    chartGrid.x = chartRect.x;
    chartGrid.y = chartRect.y;
    rightRoot.addChild(chartGrid);

    const chartBars = new PIXI.Graphics();
    chartBars.x = chartRect.x;
    chartBars.y = chartRect.y;
    rightRoot.addChild(chartBars);

    const chartLine = new PIXI.Graphics();
    chartLine.x = chartRect.x;
    chartLine.y = chartRect.y;
    rightRoot.addChild(chartLine);

    const axisTickStyle = new PIXI.Graphics();
    axisTickStyle.x = chartRect.x;
    axisTickStyle.y = chartRect.y + chartRect.h;
    rightRoot.addChild(axisTickStyle);

    const axisLabelStyle = new PIXI.TextStyle({
      fontFamily: DASHBOARD_CODE_FONT_FAMILY,
      fontSize: 15,
      fontWeight: '500',
      fill: dashboardPalette.mutedText,
      letterSpacing: 0.22,
    });
    const axisLabelDefs = [
      { label: '24H', position: 0, anchorX: 0 },
      { label: '18H', position: 0.25, anchorX: 0.5 },
      { label: '12H', position: 0.5, anchorX: 0.5 },
      { label: '6H', position: 0.75, anchorX: 0.5 },
      { label: 'NOW', position: 1, anchorX: 1 },
    ];
    const axisLabels = axisLabelDefs.map(({ label, position, anchorX }) => {
      const node = new PIXI.Text(label, axisLabelStyle);
      node.anchor.set(anchorX, 0);
      node.x = chartRect.x + chartRect.w * position;
      node.y = chartRect.y + chartRect.h + 12;
      node.roundPixels = true;
      rightRoot.addChild(node);
      return node;
    });

    const emptyText = new PIXI.Text('Awaiting task signal', new PIXI.TextStyle({
      fontFamily: DASHBOARD_CODE_FONT_FAMILY,
      fontSize: 18,
      fontWeight: '500',
      fill: dashboardPalette.mutedText,
      letterSpacing: 0.28,
    }));
    emptyText.anchor.set(0.5);
    emptyText.x = chartRect.x + chartRect.w / 2;
    emptyText.y = chartRect.y + chartRect.h / 2;
    emptyText.roundPixels = true;
    rightRoot.addChild(emptyText);

    this.wallDashboard = {
      container,
      palette: dashboardPalette,
      rotationMs: 4200,
      left: {
        rect: leftRect,
        avatarAreaW,
        statusBg: leftStatusBg,
        statusText: leftStatusText,
        avatar,
        promoAvatar,
        avatarBaseY,
        idText: leftId,
        currentAgentId: '',
        currentAvatarKey: '',
      },
      right: {
        chartRect,
        chartGrid,
        chartBars,
        chartLine,
        axisTickStyle,
        axisLabels,
        emptyText,
      },
    };

    this.world.addChild(container);
    this._syncWallDashboardOverlay(performance.now());
  }

  _syncWallDashboardOverlay(now = performance.now()) {
    if (!this.wallDashboard) return;

    const dashboard = this.wallDashboard;
    const palette = dashboard.palette || {};
    const left = dashboard.left;
    const right = dashboard.right;
    const agentEntries = this._getDashboardAgentEntries();
    const rotationIndex = agentEntries.length
      ? Math.floor(now / (dashboard.rotationMs || 4200)) % agentEntries.length
      : 0;
    const featured = agentEntries[rotationIndex] || null;
    const activity = this._getDashboard24hActivity(Date.now());
    const activitySignature = JSON.stringify({
      buckets: activity.buckets.map((bucket) => [
        bucket.running,
        bucket.pending,
        bucket.completed,
        bucket.error,
        bucket.failed,
        bucket.total,
      ]),
      totals: activity.totals,
    });

    if (featured) {
      if (featured.isDashboardPromo) {
        left.avatar.visible = false;
        left.promoAvatar.visible = true;
        const promoKey = `promo:${featured.id}`;
        if (left.currentAvatarKey !== promoKey) {
          left.promoAvatar.texture = this._dashboardPromoTexture || PIXI.Texture.WHITE;
          const tex = left.promoAvatar.texture;
          const tw = tex?.width || 1;
          const th = tex?.height || 1;
          const maxW = Math.max(56, (left.avatarAreaW || 108) - 2);
          const maxH = Math.max(48, (left.rect?.h || 120) * 0.72);
          const s = Math.min(maxW / tw, maxH / th, 1.48);
          left.promoAvatar.scale.set(s);
          left.currentAgentId = featured.id;
          left.currentAvatarKey = promoKey;
        }
        left.idText.text = featured.name || DASHBOARD_PROMO_DISPLAY_ID;
        left.statusText.text = featured.statusMeta.label;
        left.promoAvatar.alpha = 0.98;
        left.promoAvatar.tint = 0xffffff;
        left.statusText.style.fill = featured.statusMeta.textFill;

        left.statusBg.clear();
        const chipX = left.idText.x;
        const chipY = left.idText.y + left.idText.height + 12;
        const chipW = left.statusText.width + 30;
        const chipH = left.statusText.height + 14;
        left.statusBg.beginFill(featured.statusMeta.bgFill, featured.statusMeta.bgAlpha);
        left.statusBg.lineStyle(1, featured.statusMeta.borderFill, featured.statusMeta.borderAlpha);
        left.statusBg.drawRoundedRect(chipX, chipY, chipW, chipH, Math.round(chipH / 2));
        left.statusBg.endFill();
        left.statusText.x = chipX + 16;
        left.statusText.y = chipY + 7;
      } else {
        left.promoAvatar.visible = false;
        left.avatar.visible = true;
        const showcaseMode = featured.statusMeta.id === 'working'
          ? this._pickDashboardShowcaseMode(`${featured.id}-${featured.charName}`)
          : 'idle';
        const avatarKey = `${featured.id}:${featured.charName}:${featured.statusMeta.id}:${showcaseMode}`;
        if (left.currentAvatarKey !== avatarKey) {
          const charFrames = this.spriteLoader.charFrames[featured.charName] || {};
          const textures = featured.statusMeta.id === 'working'
            ? (
              showcaseMode === 'phone' && charFrames.phone?.length
                ? charFrames.phone
                : (charFrames.front?.length ? charFrames.front : (charFrames.idle || []))
            )
            : (charFrames.idle?.length ? charFrames.idle : (charFrames.front || []));
          if (textures.length) {
            left.avatar.textures = textures;
            left.avatar.animationSpeed = featured.statusMeta.id === 'working'
              ? (showcaseMode === 'phone' ? 0.11 : 0.13)
              : 0.08;
            left.avatar.play();
          }
          left.currentAgentId = featured.id;
          left.currentAvatarKey = avatarKey;
        }

        left.idText.text = featured.name || 'AGENT';
        left.statusText.text = featured.statusMeta.label;
        left.avatar.alpha = featured.statusMeta.id === 'offline' ? 0.52 : 0.96;
        left.avatar.tint = featured.statusMeta.id === 'offline' ? (palette.offlineTint || 0xbdb5ab) : 0xffffff;
        left.statusText.style.fill = featured.statusMeta.textFill;

        left.statusBg.clear();
        const chipX = left.idText.x;
        const chipY = left.idText.y + left.idText.height + 12;
        const chipW = left.statusText.width + 30;
        const chipH = left.statusText.height + 14;
        left.statusBg.beginFill(featured.statusMeta.bgFill, featured.statusMeta.bgAlpha);
        left.statusBg.lineStyle(1, featured.statusMeta.borderFill, featured.statusMeta.borderAlpha);
        left.statusBg.drawRoundedRect(chipX, chipY, chipW, chipH, Math.round(chipH / 2));
        left.statusBg.endFill();
        left.statusText.x = chipX + 16;
        left.statusText.y = chipY + 7;
      }
    } else {
      left.promoAvatar.visible = false;
      left.avatar.visible = true;
      left.idText.text = 'AGENT';
      left.statusText.text = 'OFFLINE';
      left.avatar.alpha = 0.3;
      left.avatar.tint = palette.offlineTint || 0xbdb5ab;
      left.statusText.style.fill = palette.mutedText || 0xcabfb3;
      left.statusBg.clear();
      const chipX = left.idText.x;
      const chipY = left.idText.y + left.idText.height + 12;
      const chipW = left.statusText.width + 30;
      const chipH = left.statusText.height + 14;
      left.statusBg.beginFill(palette.accent || 0xffffff, 0.08);
      left.statusBg.lineStyle(1, palette.accent || 0xffffff, 0.12);
      left.statusBg.drawRoundedRect(chipX, chipY, chipW, chipH, Math.round(chipH / 2));
      left.statusBg.endFill();
      left.statusText.x = chipX + 16;
      left.statusText.y = chipY + 7;
      left.currentAvatarKey = '';
    }

    const dashBob = Math.sin(now / 420) * 1.8;
    left.avatar.y = left.avatarBaseY + dashBob;
    if (left.promoAvatar) {
      left.promoAvatar.x = Math.round((left.avatarAreaW || 108) * 0.5);
      left.promoAvatar.y = left.avatarBaseY + dashBob;
    }

    if (activitySignature !== this._wallDashboardSignature) {
      this._wallDashboardSignature = activitySignature;

      right.chartGrid.clear();
      right.chartGrid.lineStyle(1, palette.border || 0x7f6b56, 0.24);
      for (let row = 0; row <= 2; row += 1) {
        const y = Math.round((right.chartRect.h / 2) * row);
        right.chartGrid.moveTo(0, y);
        right.chartGrid.lineTo(right.chartRect.w, y);
      }
      right.chartGrid.lineStyle(1, palette.accent || 0xb2773f, 0.08);
      for (let col = 0; col <= 4; col += 1) {
        const x = Math.round((right.chartRect.w / 4) * col);
        right.chartGrid.moveTo(x, 0);
        right.chartGrid.lineTo(x, right.chartRect.h);
      }

      right.axisTickStyle.clear();
      right.axisTickStyle.lineStyle(1, palette.accent || 0xb2773f, 0.26);
      [0, 0.25, 0.5, 0.75, 1].forEach((position) => {
        const x = Math.round(right.chartRect.w * position);
        right.axisTickStyle.moveTo(x, 0);
        right.axisTickStyle.lineTo(x, 5);
      });

      right.chartBars.clear();
      right.chartLine.clear();

      const slotW = right.chartRect.w / 24;
      const maxBarH = right.chartRect.h - 12;
      const totalPoints = [];
      const total24h = Object.values(activity.totals).reduce((sum, value) => sum + value, 0);
      right.emptyText.visible = total24h === 0;

      activity.buckets.forEach((bucket, index) => {
        const x = index * slotW + slotW / 2;
        const totalHeight = bucket.total
          ? Math.max(4, (bucket.total / activity.maxTotal) * maxBarH)
          : 0;
        const pointY = right.chartRect.h - totalHeight;
        totalPoints.push({ x, y: pointY });
      });

      if (totalPoints.length) {
        right.chartBars.lineStyle(8, palette.chartGlow || 0xe8c860, 0.22);
        this._drawSmoothDashboardCurve(right.chartBars, totalPoints, right.chartRect.h, false);

        right.chartLine.lineStyle(3.4, palette.chartLine || 0x5b3706, 0.98);
        this._drawSmoothDashboardCurve(right.chartLine, totalPoints, right.chartRect.h, false);

        const latestPoint = totalPoints[totalPoints.length - 1];
        right.chartLine.beginFill(palette.accent || 0xb2773f, 0.98);
        right.chartLine.drawCircle(latestPoint.x, latestPoint.y, 4.8);
        right.chartLine.endFill();
      }
    }
  }

  _createFloorScreenOverlay(rect) {
    this._destroyFloorScreenOverlay();
    if (!rect?.w || !rect?.h || !this.world) return;

    const width = rect.w;
    const height = rect.h;
    const padX = Math.round(width * 0.03);
    const padY = Math.round(height * 0.09);
    const gap = Math.round(width * 0.018);
    const infoWidth = Math.max(404, Math.round(width * 0.325));
    const mapWidth = Math.max(320, width - padX * 2 - infoWidth - gap);
    const mapHeight = Math.max(160, height - padY * 2);
    const infoX = padX + mapWidth + gap;
    const infoUp = Math.max(18, Math.round(height * 0.029));
    const infoY = padY - infoUp;
    const infoHeight = mapHeight + infoUp;
    const heroHeight = Math.max(196, Math.round(mapHeight * 0.28));
    const sectionGap = Math.max(10, Math.round(mapHeight * 0.02));
    const agentPanelHeight = Math.max(150, Math.round(mapHeight * 0.19));
    const taskPanelHeight = Math.max(192, infoHeight - heroHeight - agentPanelHeight - sectionGap * 2);
    const innerPadX = Math.round(infoWidth * 0.06);
    const innerPadY = Math.round(heroHeight * 0.12);

    const container = new PIXI.Container();
    container.x = rect.x;
    container.y = rect.y;
    container.zIndex = 36;
    container.sortableChildren = true;
    container.eventMode = 'none';

    const basePanel = new PIXI.Graphics();
    basePanel.beginFill(0x010203, 0.035);
    basePanel.drawRect(0, 0, width, height);
    basePanel.endFill();
    container.addChild(basePanel);

    const globalWash = new PIXI.Graphics();
    globalWash.beginFill(0x86ddff, 0.012);
    globalWash.drawRect(0, 0, width, Math.round(height * 0.18));
    globalWash.endFill();
    container.addChild(globalWash);

    const shellTopRail = new PIXI.Graphics();
    shellTopRail.beginFill(0x071016, 0.04);
    shellTopRail.drawRect(0, 0, width, Math.round(height * 0.06));
    shellTopRail.endFill();
    container.addChild(shellTopRail);

    const shellBottomRail = new PIXI.Graphics();
    shellBottomRail.beginFill(0x050b10, 0.026);
    shellBottomRail.drawRect(0, height - Math.round(height * 0.04), width, Math.round(height * 0.04));
    shellBottomRail.endFill();
    container.addChild(shellBottomRail);

    const shellFrame = new PIXI.Graphics();
    shellFrame.lineStyle(1, 0xcfefff, 0.028);
    shellFrame.drawRect(0, 0, width, height);
    shellFrame.moveTo(Math.round(width * 0.018), Math.round(height * 0.038));
    shellFrame.lineTo(Math.round(width * 0.085), Math.round(height * 0.038));
    shellFrame.moveTo(Math.round(width * 0.915), Math.round(height * 0.038));
    shellFrame.lineTo(Math.round(width * 0.982), Math.round(height * 0.038));
    shellFrame.moveTo(Math.round(width * 0.018), Math.round(height * 0.962));
    shellFrame.lineTo(Math.round(width * 0.085), Math.round(height * 0.962));
    shellFrame.moveTo(Math.round(width * 0.915), Math.round(height * 0.962));
    shellFrame.lineTo(Math.round(width * 0.982), Math.round(height * 0.962));
    container.addChild(shellFrame);

    const shellHeaderModules = new PIXI.Graphics();
    shellHeaderModules.beginFill(0x9de5ff, 0.035);
    shellHeaderModules.drawRect(Math.round(width * 0.026), Math.round(height * 0.024), Math.round(width * 0.042), 4);
    shellHeaderModules.drawRect(Math.round(width * 0.074), Math.round(height * 0.024), Math.round(width * 0.018), 4);
    shellHeaderModules.drawRect(Math.round(width * 0.934), Math.round(height * 0.024), Math.round(width * 0.028), 4);
    shellHeaderModules.drawRect(Math.round(width * 0.966), Math.round(height * 0.024), Math.round(width * 0.012), 4);
    shellHeaderModules.endFill();
    container.addChild(shellHeaderModules);

    const separator = new PIXI.Graphics();
    separator.beginFill(0x9de5ff, 0.016);
    separator.drawRect(infoX - Math.max(4, Math.round(gap * 0.28)), infoY, 1, infoHeight);
    separator.endFill();
    container.addChild(separator);

    const mapViewport = new PIXI.Container();
    mapViewport.x = padX;
    mapViewport.y = padY;
    mapViewport.eventMode = 'none';
    container.addChild(mapViewport);

    const mapMask = new PIXI.Graphics();
    mapMask.beginFill(0xffffff, 1);
    mapMask.drawRect(padX, padY, mapWidth, mapHeight);
    mapMask.endFill();
    container.addChild(mapMask);
    mapViewport.mask = mapMask;

    const mapBackdrop = new PIXI.Graphics();
    mapBackdrop.beginFill(0x010203, 0.018);
    mapBackdrop.drawRect(0, 0, mapWidth, mapHeight);
    mapBackdrop.endFill();
    mapViewport.addChild(mapBackdrop);

    const previewTexture = this._floorScreenPreviewTexture
      || this.tiledRenderer?._findWholeImageTileset?.()?.texture
      || (this.mapConfig?.imageAsset ? PIXI.Texture.from(this.mapConfig.imageAsset) : null);

    let mapSprite = null;
    let previewRect = { x: 0, y: 0, w: mapWidth, h: mapHeight };
    if (previewTexture) {
      mapSprite = new PIXI.Sprite(previewTexture);
      const texW = previewTexture.width || previewTexture.baseTexture?.width || 1;
      const texH = previewTexture.height || previewTexture.baseTexture?.height || 1;
      const previewScale = Math.min(mapWidth / texW, mapHeight / texH);
      mapSprite.scale.set(previewScale);
      mapSprite.x = Math.round((mapWidth - texW * previewScale) / 2);
      mapSprite.y = Math.round((mapHeight - texH * previewScale) / 2);
      previewRect = {
        x: mapSprite.x,
        y: mapSprite.y,
        w: texW * previewScale,
        h: texH * previewScale,
      };
      mapSprite.alpha = 0.58;
      mapSprite.tint = 0xffffff;
      mapViewport.addChild(mapSprite);
    }

    const mapShade = new PIXI.Graphics();
    mapShade.beginFill(0x020406, 0.08);
    mapShade.drawRect(0, 0, mapWidth, mapHeight);
    mapShade.endFill();
    mapViewport.addChild(mapShade);

    const mapGloss = new PIXI.Graphics();
    mapGloss.beginFill(0x9de5ff, 0.028);
    mapGloss.drawRect(0, 0, mapWidth, Math.round(mapHeight * 0.16));
    mapGloss.endFill();
    mapViewport.addChild(mapGloss);

    const mapFrame = new PIXI.Graphics();
    mapFrame.lineStyle(1, 0xcfefff, 0.055);
    mapFrame.drawRect(0, 0, mapWidth, mapHeight);
    mapFrame.moveTo(Math.round(mapWidth * 0.025), Math.round(mapHeight * 0.028));
    mapFrame.lineTo(Math.round(mapWidth * 0.14), Math.round(mapHeight * 0.028));
    mapFrame.moveTo(Math.round(mapWidth * 0.025), Math.round(mapHeight * 0.052));
    mapFrame.lineTo(Math.round(mapWidth * 0.1), Math.round(mapHeight * 0.052));
    mapFrame.moveTo(Math.round(mapWidth * 0.86), Math.round(mapHeight * 0.948));
    mapFrame.lineTo(Math.round(mapWidth * 0.975), Math.round(mapHeight * 0.948));
    mapFrame.moveTo(Math.round(mapWidth * 0.9), Math.round(mapHeight * 0.924));
    mapFrame.lineTo(Math.round(mapWidth * 0.975), Math.round(mapHeight * 0.924));
    mapViewport.addChild(mapFrame);

    const mapMicroBoxes = new PIXI.Graphics();
    mapMicroBoxes.beginFill(0x9de5ff, 0.05);
    mapMicroBoxes.drawRect(Math.round(mapWidth * 0.028), Math.round(mapHeight * 0.082), Math.round(mapWidth * 0.05), 4);
    mapMicroBoxes.drawRect(Math.round(mapWidth * 0.085), Math.round(mapHeight * 0.082), Math.round(mapWidth * 0.022), 4);
    mapMicroBoxes.drawRect(Math.round(mapWidth * 0.915), Math.round(mapHeight * 0.06), Math.round(mapWidth * 0.04), 4);
    mapMicroBoxes.endFill();
    mapViewport.addChild(mapMicroBoxes);

    const gridOverlay = new PIXI.Graphics();
    gridOverlay.lineStyle(1, 0x8ee5ff, 0.07);
    const gridStep = Math.max(48, Math.round(mapHeight / 10));
    for (let x = 0; x <= mapWidth; x += gridStep) {
      gridOverlay.moveTo(x, 0);
      gridOverlay.lineTo(x, mapHeight);
    }
    for (let y = 0; y <= mapHeight; y += gridStep) {
      gridOverlay.moveTo(0, y);
      gridOverlay.lineTo(mapWidth, y);
    }
    mapViewport.addChild(gridOverlay);

    const scanlineOverlay = new PIXI.Graphics();
    for (let y = 0; y < mapHeight; y += 10) {
      scanlineOverlay.beginFill(0xb6ecff, 0.008);
      scanlineOverlay.drawRect(0, y, mapWidth, 1);
      scanlineOverlay.endFill();
    }
    mapViewport.addChild(scanlineOverlay);

    const sweepWidth = Math.max(48, Math.round(mapWidth * 0.1));
    const sweep = new PIXI.Graphics();
    sweep.beginFill(0x8ef9ff, 0.065);
    sweep.drawPolygon([0, 0, sweepWidth, 0, sweepWidth - Math.round(sweepWidth * 0.24), mapHeight, -Math.round(sweepWidth * 0.24), mapHeight]);
    sweep.endFill();
    sweep.blendMode = PIXI.BLEND_MODES.ADD;
    mapViewport.addChild(sweep);

    const markerLayer = new PIXI.Container();
    markerLayer.eventMode = 'none';
    mapViewport.addChild(markerLayer);

    const infoShell = new PIXI.Graphics();
    infoShell.beginFill(0x020609, 0.05);
    infoShell.drawRect(infoX, infoY, infoWidth, infoHeight);
    infoShell.endFill();
    infoShell.lineStyle(1, 0xcfefff, 0.032);
    infoShell.drawRect(infoX, infoY, infoWidth, infoHeight);
    infoShell.moveTo(infoX + Math.round(infoWidth * 0.04), infoY + heroHeight + Math.round(sectionGap * 0.5));
    infoShell.lineTo(infoX + Math.round(infoWidth * 0.96), infoY + heroHeight + Math.round(sectionGap * 0.5));
    infoShell.moveTo(infoX + Math.round(infoWidth * 0.04), infoY + heroHeight + agentPanelHeight + Math.round(sectionGap * 1.5));
    infoShell.lineTo(infoX + Math.round(infoWidth * 0.96), infoY + heroHeight + agentPanelHeight + Math.round(sectionGap * 1.5));
    container.addChild(infoShell);

    const infoShellWash = new PIXI.Graphics();
    infoShellWash.beginFill(0x8edfff, 0.014);
    infoShellWash.drawRect(infoX, infoY, infoWidth, Math.round(infoHeight * 0.12));
    infoShellWash.endFill();
    container.addChild(infoShellWash);

    const infoShellRail = new PIXI.Graphics();
    infoShellRail.beginFill(0x9de5ff, 0.032);
    infoShellRail.drawRect(infoX, infoY + Math.round(infoHeight * 0.045), 2, Math.round(infoHeight * 0.18));
    infoShellRail.endFill();
    container.addChild(infoShellRail);

    const infoShellModules = new PIXI.Graphics();
    infoShellModules.beginFill(0x9de5ff, 0.038);
    infoShellModules.drawRect(infoX + Math.round(infoWidth * 0.74), infoY + Math.round(infoHeight * 0.024), Math.round(infoWidth * 0.04), 4);
    infoShellModules.drawRect(infoX + Math.round(infoWidth * 0.788), infoY + Math.round(infoHeight * 0.024), Math.round(infoWidth * 0.024), 4);
    infoShellModules.drawRect(infoX + Math.round(infoWidth * 0.818), infoY + Math.round(infoHeight * 0.024), Math.round(infoWidth * 0.062), 4);
    infoShellModules.endFill();
    container.addChild(infoShellModules);

    const labelStyle = {
      fontFamily: 'Press Start 2P, monospace',
      fontSize: Math.max(12, Math.round(height * 0.016)),
      fill: 0xaecddd,
      letterSpacing: 1.2,
    };
    const panelTitleStyle = {
      fontFamily: 'Press Start 2P, monospace',
      fontSize: Math.max(15, Math.round(height * 0.02)),
      fill: 0xe9f8ff,
      letterSpacing: 1,
    };
    const rowLabelStyle = {
      fontFamily: 'Press Start 2P, monospace',
      fontSize: Math.max(15, Math.round(height * 0.021)),
      fill: 0xd8effa,
      letterSpacing: 0.9,
    };
    const rowValueStyle = {
      fontFamily: 'Arial, sans-serif',
      fontSize: Math.max(54, Math.round(height * 0.082)),
      fill: 0xfbfeff,
      fontWeight: '700',
      letterSpacing: 0.5,
    };
    const welcomeLeadStyle = {
      fontFamily: 'Press Start 2P, monospace',
      fontSize: Math.max(13, Math.round(height * 0.018)),
      fill: 0x8edfff,
      letterSpacing: 1.5,
    };
    const welcomeTitleStyle = {
      fontFamily: 'Press Start 2P, monospace',
      fontSize: Math.max(34, Math.round(height * 0.045)),
      fill: 0xf4fbff,
      letterSpacing: 1.1,
    };
    const heroSubStyle = {
      fontFamily: 'Arial, sans-serif',
      fontSize: Math.max(20, Math.round(height * 0.028)),
      fill: 0xb9deef,
      fontWeight: '700',
      letterSpacing: 0.8,
    };

    const infoLayer = new PIXI.Container();
    infoLayer.x = infoX;
    infoLayer.y = infoY;
    infoLayer.eventMode = 'none';
    container.addChild(infoLayer);

    const heroPanel = new PIXI.Container();
    heroPanel.eventMode = 'none';
    infoLayer.addChild(heroPanel);

    const heroBg = new PIXI.Graphics();
    heroBg.beginFill(0x020507, 0.026);
    heroBg.drawRect(0, 0, infoWidth, heroHeight);
    heroBg.endFill();
    heroPanel.addChild(heroBg);

    const heroCoolOverlay = new PIXI.Graphics();
    heroCoolOverlay.beginFill(0x8edfff, 0.01);
    heroCoolOverlay.drawRect(0, 0, infoWidth, Math.round(heroHeight * 0.22));
    heroCoolOverlay.endFill();
    heroPanel.addChild(heroCoolOverlay);

    const heroWarnOverlay = new PIXI.Graphics();
    heroWarnOverlay.beginFill(0xff5a66, 0.028);
    heroWarnOverlay.drawRect(0, 0, infoWidth, heroHeight);
    heroWarnOverlay.endFill();
    heroWarnOverlay.alpha = 0;
    heroPanel.addChild(heroWarnOverlay);

    const heroFrame = new PIXI.Graphics();
    heroFrame.lineStyle(1, 0xcfefff, 0.024);
    heroFrame.drawRect(0, 0, infoWidth, heroHeight);
    heroFrame.moveTo(Math.round(infoWidth * 0.03), Math.round(heroHeight * 0.11));
    heroFrame.lineTo(Math.round(infoWidth * 0.11), Math.round(heroHeight * 0.11));
    heroFrame.moveTo(Math.round(infoWidth * 0.82), Math.round(heroHeight * 0.11));
    heroFrame.lineTo(Math.round(infoWidth * 0.97), Math.round(heroHeight * 0.11));
    heroFrame.moveTo(Math.round(infoWidth * 0.89), Math.round(heroHeight * 0.88));
    heroFrame.lineTo(Math.round(infoWidth * 0.97), Math.round(heroHeight * 0.88));
    heroPanel.addChild(heroFrame);

    const heroMicroBoxes = new PIXI.Graphics();
    heroMicroBoxes.beginFill(0x9de5ff, 0.022);
    heroMicroBoxes.drawRect(Math.round(infoWidth * 0.79), Math.round(heroHeight * 0.08), Math.round(infoWidth * 0.034), 4);
    heroMicroBoxes.drawRect(Math.round(infoWidth * 0.832), Math.round(heroHeight * 0.08), Math.round(infoWidth * 0.022), 4);
    heroMicroBoxes.drawRect(Math.round(infoWidth * 0.862), Math.round(heroHeight * 0.08), Math.round(infoWidth * 0.058), 4);
    heroMicroBoxes.endFill();
    heroPanel.addChild(heroMicroBoxes);

    const heroLabel = new PIXI.Text('TACTICAL FLOOR DISPLAY', new PIXI.TextStyle(labelStyle));
    heroLabel.x = innerPadX;
    heroLabel.y = innerPadY;
    heroLabel.alpha = 0.84;
    heroLabel.roundPixels = true;
    heroPanel.addChild(heroLabel);

    const welcomeGroup = new PIXI.Container();
    welcomeGroup.x = innerPadX;
    welcomeGroup.y = heroLabel.y + heroLabel.height + Math.round(heroHeight * 0.13);
    heroPanel.addChild(welcomeGroup);

    const welcomeLead = new PIXI.Text('WELCOME TO', new PIXI.TextStyle(welcomeLeadStyle));
    welcomeLead.roundPixels = true;
    welcomeGroup.addChild(welcomeLead);

    const welcomeTitle = new PIXI.Text('AGENT VALLEY', new PIXI.TextStyle(welcomeTitleStyle));
    welcomeTitle.y = welcomeLead.height + Math.round(heroHeight * 0.055);
    welcomeTitle.roundPixels = true;
    welcomeGroup.addChild(welcomeTitle);

    const welcomeSub = new PIXI.Text('Monitoring grid online', new PIXI.TextStyle(heroSubStyle));
    welcomeSub.y = welcomeTitle.y + welcomeTitle.height + Math.round(heroHeight * 0.08);
    welcomeSub.roundPixels = true;
    welcomeGroup.addChild(welcomeSub);

    const guardStatusLine = new PIXI.Text(
      this.guardEnabled ? '⚔ GUARD ACTIVE' : '⚠ GUARD OFFLINE',
      new PIXI.TextStyle({
        fontFamily: 'Press Start 2P, monospace',
        fontSize: Math.max(11, Math.round(height * 0.016)),
        fill: this.guardEnabled ? 0x34d399 : 0xffa500,
        letterSpacing: 1.2,
      })
    );
    guardStatusLine.y = welcomeSub.y + welcomeSub.height + Math.round(heroHeight * 0.05);
    guardStatusLine.roundPixels = true;
    welcomeGroup.addChild(guardStatusLine);

    const welcomeDecoLeft = new PIXI.Graphics();
    welcomeDecoLeft.lineStyle(2, 0x8edfff, 0.42);
    welcomeDecoLeft.moveTo(0, 0);
    welcomeDecoLeft.lineTo(Math.round(infoWidth * 0.16), 0);
    welcomeDecoLeft.moveTo(Math.round(infoWidth * 0.02), 12);
    welcomeDecoLeft.lineTo(Math.round(infoWidth * 0.12), 12);
    welcomeDecoLeft.x = 0;
    welcomeDecoLeft.y = guardStatusLine.y + guardStatusLine.height + Math.round(heroHeight * 0.06);
    welcomeGroup.addChild(welcomeDecoLeft);

    const welcomeDecoRight = new PIXI.Graphics();
    welcomeDecoRight.beginFill(0x8edfff, 0.28);
    welcomeDecoRight.drawRect(0, 0, Math.round(infoWidth * 0.022), Math.round(heroHeight * 0.015));
    welcomeDecoRight.drawRect(Math.round(infoWidth * 0.034), 0, Math.round(infoWidth * 0.035), Math.round(heroHeight * 0.015));
    welcomeDecoRight.drawRect(Math.round(infoWidth * 0.081), 0, Math.round(infoWidth * 0.015), Math.round(heroHeight * 0.015));
    welcomeDecoRight.endFill();
    const welcomeDecoRightBaseX = Math.round(infoWidth * 0.22);
    welcomeDecoRight.x = welcomeDecoRightBaseX;
    welcomeDecoRight.y = welcomeDecoLeft.y - Math.round(heroHeight * 0.004);
    welcomeGroup.addChild(welcomeDecoRight);

    const warningGroup = new PIXI.Container();
    warningGroup.x = innerPadX;
    warningGroup.y = heroLabel.y + heroLabel.height + Math.round(heroHeight * 0.11);
    warningGroup.visible = false;
    heroPanel.addChild(warningGroup);

    const warningTriangle = new PIXI.Container();
    warningTriangle.x = Math.round(infoWidth * 0.06);
    warningTriangle.y = Math.round(heroHeight * 0.12);
    warningGroup.addChild(warningTriangle);

    const warningTriangleSide = Math.max(58, Math.round(infoWidth * 0.125));
    const warningTriangleWidth = warningTriangleSide;
    const warningTriangleHeight = Math.round((warningTriangleSide * Math.sqrt(3)) / 2);
    const warningTextX = warningTriangle.x + Math.round(warningTriangleWidth * 0.54) + Math.round(infoWidth * 0.05);

    const warningTriangleShape = new PIXI.Graphics();
    warningTriangleShape.lineStyle(2, 0xffc4ca, 0.18);
    warningTriangleShape.beginFill(0xff5a66, 0.98);
    warningTriangleShape.drawPolygon([
      0, 0,
      Math.round(warningTriangleWidth / 2), warningTriangleHeight,
      -Math.round(warningTriangleWidth / 2), warningTriangleHeight,
    ]);
    warningTriangleShape.endFill();
    warningTriangle.addChild(warningTriangleShape);

    const warningBang = new PIXI.Container();
    const warningBangColor = 0x260507;
    const bangStemW = Math.max(8, Math.round(warningTriangleWidth * 0.115));
    const bangStemH = Math.max(22, Math.round(warningTriangleHeight * 0.38));
    const bangTopY = Math.max(9, Math.round(warningTriangleHeight * 0.18));
    const bangGap = Math.max(4, Math.round(warningTriangleHeight * 0.055));
    const bangDotR = Math.max(4, Math.round(warningTriangleWidth * 0.08));

    const bangStem = new PIXI.Graphics();
    bangStem.beginFill(warningBangColor, 0.98);
    bangStem.drawRoundedRect(
      -Math.round(bangStemW / 2),
      bangTopY,
      bangStemW,
      bangStemH,
      Math.max(3, Math.round(bangStemW / 2)),
    );
    bangStem.endFill();
    warningBang.addChild(bangStem);

    const bangDot = new PIXI.Graphics();
    bangDot.beginFill(warningBangColor, 0.98);
    bangDot.drawCircle(0, bangTopY + bangStemH + bangGap + bangDotR, bangDotR);
    bangDot.endFill();
    warningBang.addChild(bangDot);

    warningBang.x = 0;
    warningBang.y = Math.max(2, Math.round(warningTriangleHeight * 0.05));
    warningTriangle.addChild(warningBang);

    const warningLead = new PIXI.Text('WARNING', new PIXI.TextStyle({
      fontFamily: 'Press Start 2P, monospace',
      fontSize: Math.max(16, Math.round(height * 0.022)),
      fill: 0xffaab1,
      letterSpacing: 1.2,
    }));
    warningLead.x = warningTextX;
    warningLead.y = 0;
    warningLead.roundPixels = true;
    warningGroup.addChild(warningLead);

    const warningTitle = new PIXI.Text('PRIORITY REVIEW', new PIXI.TextStyle({
      fontFamily: 'Press Start 2P, monospace',
      fontSize: Math.max(25, Math.round(height * 0.033)),
      fill: 0xfff2f3,
      letterSpacing: 1,
    }));
    warningTitle.x = warningLead.x;
    warningTitle.y = warningLead.height + Math.round(heroHeight * 0.05);
    warningTitle.roundPixels = true;
    warningGroup.addChild(warningTitle);

    const warningSub = new PIXI.Text('Handle pending events first', new PIXI.TextStyle({
      ...heroSubStyle,
      fill: 0xffcfd3,
    }));
    warningSub.x = warningLead.x;
    warningSub.y = warningTitle.y + warningTitle.height + Math.round(heroHeight * 0.06);
    warningSub.roundPixels = true;
    warningGroup.addChild(warningSub);

    const warningCount = new PIXI.Text('00 pending agents', new PIXI.TextStyle({
      fontFamily: 'Press Start 2P, monospace',
      fontSize: Math.max(15, Math.round(height * 0.019)),
      fill: 0xff8089,
      letterSpacing: 0.9,
    }));
    warningCount.x = warningLead.x;
    warningCount.y = warningSub.y + warningSub.height + Math.round(heroHeight * 0.02);
    warningCount.roundPixels = true;
    warningGroup.addChild(warningCount);

    const createDashboardPanel = ({ x, y, panelWidth, panelHeight, title, metrics, columns = 2 }) => {
      const panel = new PIXI.Container();
      panel.x = x;
      panel.y = y;
      panel.eventMode = 'none';
      infoLayer.addChild(panel);

      const bg = new PIXI.Graphics();
      bg.beginFill(0x020507, 0.018);
      bg.drawRect(0, 0, panelWidth, panelHeight);
      bg.endFill();
      panel.addChild(bg);

      const wash = new PIXI.Graphics();
      wash.beginFill(0x8edfff, 0.006);
      wash.drawRect(0, 0, panelWidth, Math.round(panelHeight * 0.16));
      wash.endFill();
      panel.addChild(wash);

      const frame = new PIXI.Graphics();
      frame.lineStyle(1, 0xcfefff, 0.014);
      frame.drawRect(0, 0, panelWidth, panelHeight);
      frame.moveTo(Math.round(panelWidth * 0.03), Math.round(panelHeight * 0.14));
      frame.lineTo(Math.round(panelWidth * 0.12), Math.round(panelHeight * 0.14));
      frame.moveTo(Math.round(panelWidth * 0.88), Math.round(panelHeight * 0.14));
      frame.lineTo(Math.round(panelWidth * 0.97), Math.round(panelHeight * 0.14));
      panel.addChild(frame);

      const headerBoxes = new PIXI.Graphics();
      headerBoxes.beginFill(0x9de5ff, 0.018);
      headerBoxes.drawRect(panelWidth - innerPadX - 76, Math.round(panelHeight * 0.14), 18, 4);
      headerBoxes.drawRect(panelWidth - innerPadX - 52, Math.round(panelHeight * 0.14), 10, 4);
      headerBoxes.drawRect(panelWidth - innerPadX - 36, Math.round(panelHeight * 0.14), 28, 4);
      headerBoxes.endFill();
      panel.addChild(headerBoxes);

      const titleNode = new PIXI.Text(title, new PIXI.TextStyle(panelTitleStyle));
      titleNode.x = innerPadX;
      titleNode.y = Math.round(panelHeight * 0.12);
      titleNode.alpha = 0.96;
      titleNode.roundPixels = true;
      panel.addChild(titleNode);

      const tileTop = titleNode.y + titleNode.height + Math.round(panelHeight * 0.14);
      const tileGapX = Math.max(10, Math.round(panelWidth * 0.028));
      const tileGapY = Math.max(8, Math.round(panelHeight * 0.06));
      const rowCount = Math.max(1, Math.ceil(metrics.length / columns));
      const tileWidth = Math.floor((panelWidth - innerPadX * 2 - tileGapX * (columns - 1)) / columns);
      const tileHeight = Math.floor((panelHeight - tileTop - Math.round(panelHeight * 0.1) - tileGapY * (rowCount - 1)) / rowCount);
      const metricNodes = {};

      metrics.forEach((metric, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const tileYOffset = typeof metric.tileOffsetY === 'number' ? metric.tileOffsetY : 0;
        const tile = new PIXI.Container();
        tile.x = innerPadX + col * (tileWidth + tileGapX);
        tile.y = tileTop + row * (tileHeight + tileGapY) + tileYOffset;
        panel.addChild(tile);

        const tileBg = new PIXI.Graphics();
        tileBg.beginFill(0x081018, 0.05);
        tileBg.drawRect(0, 0, tileWidth, tileHeight);
        tileBg.endFill();
        tile.addChild(tileBg);

        const tileFrame = new PIXI.Graphics();
        tileFrame.lineStyle(1, 0xcfefff, 0.012);
        tileFrame.drawRect(0, 0, tileWidth, tileHeight);
        tile.addChild(tileFrame);

        const labelPadTop = Math.round(tileHeight * 0.06);
        const label = new PIXI.Text(metric.label, new PIXI.TextStyle({
          ...rowLabelStyle,
          fill: metric.labelFill || rowLabelStyle.fill,
        }));
        label.x = Math.round(tileWidth * 0.08);
        label.y = labelPadTop;
        label.roundPixels = true;
        tile.addChild(label);

        const barGap = Math.max(8, Math.round(tileHeight * 0.08));
        const tileBar = new PIXI.Graphics();
        tileBar.beginFill(metric.fill, 0.92);
        tileBar.drawRect(0, 0, tileWidth, 3);
        tileBar.endFill();
        tileBar.x = 0;
        tileBar.y = label.y + label.height + barGap;
        tile.addChild(tileBar);

        const tileWash = new PIXI.Graphics();
        tileWash.beginFill(metric.fill, 0.014);
        tileWash.drawRect(0, tileBar.y + 3, tileWidth, Math.round(tileHeight * 0.18));
        tileWash.endFill();
        tile.addChild(tileWash);

        const valueGap = Math.max(10, Math.round(tileHeight * 0.06));
        const value = new PIXI.Text('00', new PIXI.TextStyle({
          ...rowValueStyle,
          fill: metric.fill,
        }));
        value.x = Math.round(tileWidth * 0.08);
        value.y = tileBar.y + 3 + valueGap;
        value.roundPixels = true;
        tile.addChild(value);

        metricNodes[metric.key] = { tile, tileBg, tileBar, label, value };
      });

      return { panel, titleNode, metricNodes };
    };

    const agentPanel = createDashboardPanel({
      x: 0,
      y: heroHeight + sectionGap,
      panelWidth: infoWidth,
      panelHeight: agentPanelHeight,
      title: 'AGENT DASHBOARD',
      columns: 3,
      metrics: [
        { key: 'working', label: 'WORKING', fill: 0x97f5ff },
        { key: 'pending', label: 'PENDING', fill: 0xff5664 },
        { key: 'total', label: 'TOTAL', fill: 0xc8d4dc },
      ],
    });

    const taskPanel = createDashboardPanel({
      x: 0,
      y: heroHeight + sectionGap * 2 + agentPanelHeight,
      panelWidth: infoWidth,
      panelHeight: taskPanelHeight,
      title: 'TASK DASHBOARD',
      columns: 2,
      /* Order matches console: running → pending (omitted) → completed → failed → error */
      metrics: [
        { key: 'running', label: 'RUNNING', fill: 0x97f5ff, tileOffsetY: -16 },
        { key: 'completed', label: 'COMPLETED', fill: 0x99f2bf, tileOffsetY: -16 },
        { key: 'failed', label: 'FAILED', fill: 0xffb382, tileOffsetY: 16 },
        { key: 'error', label: 'ERROR', fill: 0xff6b8a, tileOffsetY: 16 },
      ],
    });

    const markerPool = Array.from({ length: 40 }, () => {
      const markerGroup = new PIXI.Container();
      markerGroup.visible = false;
      markerGroup.eventMode = 'none';

      const glow = new PIXI.Graphics();
      const brackets = new PIXI.Graphics();
      const dot = new PIXI.Graphics();

      markerGroup.addChild(glow);
      markerGroup.addChild(brackets);
      markerGroup.addChild(dot);
      markerLayer.addChild(markerGroup);

      return { markerGroup, glow, brackets, dot };
    });

    this.floorScreen = {
      container,
      markerPool,
      mapWidth,
      mapHeight,
      sweep,
      sweepWidth,
      hero: {
        heroCoolOverlay,
        heroWarnOverlay,
        welcomeGroup,
        welcomeLead,
        welcomeTitle,
        welcomeTitleBaseY: welcomeTitle.y,
        welcomeSub,
        welcomeDecoLeft,
        welcomeDecoLeftBaseX: welcomeDecoLeft.x,
        welcomeDecoRight,
        welcomeDecoRightBaseX,
        guardStatusLine,
        warningGroup,
        warningTriangle,
        warningBang,
        warningSub,
        warningCount,
      },
      panels: {
        agent: agentPanel,
        task: taskPanel,
      },
      previewRect,
    };

    this.world.addChild(container);
    this._syncFloorScreenOverlay(performance.now());
  }

  _syncFloorScreenOverlay(now = performance.now()) {
    if (!this.floorScreen) return;

    const telemetry = this.getMapScreenTelemetry();
    const formatCount = (value) => String(value ?? 0).padStart(2, '0');
    const priority = { pending: 3, active: 2, idle: 1 };
    const markers = telemetry.markers
      .slice()
      .sort((a, b) => (priority[b.kind] || 0) - (priority[a.kind] || 0))
      .slice(0, this.floorScreen.markerPool.length);

    const ambientPulse = Math.sin(now / 260) * 0.12 + 0.88;
    const pendingPulse = Math.sin(now / 180) * 0.16 + 0.94;

    for (let index = 0; index < this.floorScreen.markerPool.length; index++) {
      const markerNode = this.floorScreen.markerPool[index];
      const marker = markers[index];
      if (!marker) {
        markerNode.markerGroup.visible = false;
        continue;
      }

      const previewRect = this.floorScreen.previewRect || {
        x: 0,
        y: 0,
        w: this.floorScreen.mapWidth,
        h: this.floorScreen.mapHeight,
      };
      const markerInset = marker.kind === 'pending' ? 18 : 8;
      const rawX = previewRect.x + (marker.x / Math.max(1, telemetry.sceneW)) * previewRect.w;
      const rawY = previewRect.y + (marker.y / Math.max(1, telemetry.sceneH)) * previewRect.h;
      const x = Math.min(
        previewRect.x + previewRect.w - markerInset,
        Math.max(previewRect.x + markerInset, rawX)
      );
      const y = Math.min(
        previewRect.y + previewRect.h - markerInset,
        Math.max(previewRect.y + markerInset, rawY)
      );
      markerNode.markerGroup.visible = true;
      markerNode.markerGroup.x = x;
      markerNode.markerGroup.y = y;

      markerNode.glow.clear();
      markerNode.dot.clear();
      markerNode.brackets.clear();

      if (marker.kind === 'pending') {
        const bracketRadius = 17 * pendingPulse;
        markerNode.glow.beginFill(0xff5664, 0.18);
        markerNode.glow.drawCircle(0, 0, 18 * pendingPulse);
        markerNode.glow.endFill();

        markerNode.dot.beginFill(0xff5d68, 1);
        markerNode.dot.drawCircle(0, 0, 6);
        markerNode.dot.endFill();

        markerNode.brackets.lineStyle(2, 0xffd6d9, 0.95);
        const arm = 6;
        markerNode.brackets.moveTo(-bracketRadius, -bracketRadius + arm);
        markerNode.brackets.lineTo(-bracketRadius, -bracketRadius);
        markerNode.brackets.lineTo(-bracketRadius + arm, -bracketRadius);
        markerNode.brackets.moveTo(bracketRadius - arm, -bracketRadius);
        markerNode.brackets.lineTo(bracketRadius, -bracketRadius);
        markerNode.brackets.lineTo(bracketRadius, -bracketRadius + arm);
        markerNode.brackets.moveTo(-bracketRadius, bracketRadius - arm);
        markerNode.brackets.lineTo(-bracketRadius, bracketRadius);
        markerNode.brackets.lineTo(-bracketRadius + arm, bracketRadius);
        markerNode.brackets.moveTo(bracketRadius - arm, bracketRadius);
        markerNode.brackets.lineTo(bracketRadius, bracketRadius);
        markerNode.brackets.lineTo(bracketRadius, bracketRadius - arm);

        markerNode.markerGroup.alpha = 0.92 + Math.sin(now / 160 + index) * 0.08;
        markerNode.markerGroup.scale.set(1 + Math.sin(now / 180 + index) * 0.035);
      } else {
        const isActive = marker.kind === 'active';
        const color = isActive ? 0x95f4ff : 0xddeff8;
        const size = isActive ? 5.5 : 4.5;
        const glowAlpha = isActive ? 0.12 : 0.08;

        markerNode.glow.beginFill(color, glowAlpha);
        markerNode.glow.drawCircle(0, 0, size * 2.3 * ambientPulse);
        markerNode.glow.endFill();

        markerNode.dot.beginFill(color, isActive ? 0.95 : 0.76);
        markerNode.dot.drawCircle(0, 0, size);
        markerNode.dot.endFill();

        markerNode.markerGroup.alpha = isActive ? 0.92 : 0.68;
        markerNode.markerGroup.scale.set(1);
      }
    }

    const sweepTravel = this.floorScreen.mapWidth + this.floorScreen.sweepWidth * 1.4;
    this.floorScreen.sweep.x = ((now * 0.18) % sweepTravel) - this.floorScreen.sweepWidth;
    this.floorScreen.sweep.alpha = 0.08 + Math.sin(now / 420) * 0.02;

    const hasPendingAlert = (telemetry.pendingCount || 0) > 0;
    const taskSummary = telemetry.taskSummary || {
      running: 0,
      completed: 0,
      error: 0,
      failed: 0,
    };
    const signature = JSON.stringify({
      working: telemetry.workingCount || 0,
      pending: telemetry.pendingCount || 0,
      offline: telemetry.offlineCount || 0,
      taskSummary,
      hasPendingAlert,
      guardEnabled: !!this.guardEnabled,
    });

    if (signature !== this._floorScreenInfoSignature) {
      this._floorScreenInfoSignature = signature;

      this.floorScreen.panels.agent.metricNodes.working.value.text = formatCount(telemetry.workingCount);
      this.floorScreen.panels.agent.metricNodes.pending.value.text = formatCount(telemetry.pendingCount);
      this.floorScreen.panels.agent.metricNodes.total.value.text = formatCount(telemetry.agentCount);

      this.floorScreen.panels.task.metricNodes.running.value.text = formatCount(taskSummary.running);
      this.floorScreen.panels.task.metricNodes.completed.value.text = formatCount(taskSummary.completed);
      this.floorScreen.panels.task.metricNodes.failed.value.text = formatCount(taskSummary.failed);
      this.floorScreen.panels.task.metricNodes.error.value.text = formatCount(taskSummary.error);

      this.floorScreen.hero.warningSub.text = hasPendingAlert
        ? 'Handle pending events first'
        : this.floorScreen.hero.warningSub.text;
      this.floorScreen.hero.warningCount.text = `${formatCount(telemetry.pendingCount)} PENDING`;
      this.floorScreen.hero.welcomeSub.text = taskSummary.running > 0
        ? `${formatCount(taskSummary.running)} tasks active on the grid`
        : 'No pending approvals on the floor';

      const gLine = this.floorScreen.hero.guardStatusLine;
      if (gLine) {
        gLine.text = this.guardEnabled ? '⚔ GUARD ACTIVE' : '⚠ GUARD OFFLINE';
        gLine.style.fill = this.guardEnabled ? 0x34d399 : 0xffa500;
      }
    }

    this.floorScreen.hero.heroCoolOverlay.alpha = hasPendingAlert
      ? 0.012
      : 0.03 + Math.sin(now / 920) * 0.01;
    this.floorScreen.hero.heroWarnOverlay.alpha = hasPendingAlert
      ? 0.04 + Math.sin(now / 180) * 0.02
      : 0;
    this.floorScreen.hero.welcomeGroup.visible = !hasPendingAlert;
    this.floorScreen.hero.warningGroup.visible = hasPendingAlert;

    if (hasPendingAlert) {
      this.floorScreen.hero.warningTriangle.scale.set(pendingPulse);
      this.floorScreen.hero.warningTriangle.alpha = 0.88 + Math.sin(now / 140) * 0.12;
      this.floorScreen.hero.warningBang.alpha = 0.9 + Math.sin(now / 180) * 0.08;
      this.floorScreen.hero.warningCount.alpha = 0.84 + Math.sin(now / 220) * 0.12;
    } else {
      this.floorScreen.hero.welcomeLead.alpha = 0.74 + Math.sin(now / 800) * 0.12;
      this.floorScreen.hero.welcomeTitle.alpha = 0.92 + Math.sin(now / 620) * 0.08;
      this.floorScreen.hero.welcomeTitle.y = this.floorScreen.hero.welcomeTitleBaseY + Math.sin(now / 700) * 2;
      this.floorScreen.hero.welcomeSub.alpha = 0.72 + Math.sin(now / 760) * 0.08;
      this.floorScreen.hero.welcomeDecoLeft.alpha = 0.34 + Math.sin(now / 540) * 0.16;
      this.floorScreen.hero.welcomeDecoRight.alpha = 0.28 + Math.sin(now / 480) * 0.18;
      this.floorScreen.hero.welcomeDecoLeft.x = this.floorScreen.hero.welcomeDecoLeftBaseX + Math.sin(now / 520) * 6;
      this.floorScreen.hero.welcomeDecoRight.x = this.floorScreen.hero.welcomeDecoRightBaseX + Math.sin(now / 660) * 8;
    }
  }

  async _loadGuardAssets() {
    try {
      const [portalTex, agentPortalTex, idleTex, walkTex, attackTex, issueQuestionTex] = await Promise.all([
        PIXI.Assets.load(GUARD_PORTAL_URL),
        PIXI.Assets.load(AGENT_PORTAL_URL),
        PIXI.Assets.load(GUARD_IDLE_URL),
        PIXI.Assets.load(GUARD_WALK_URL),
        PIXI.Assets.load(GUARD_ATTACK_URL),
        PIXI.Assets.load(ISSUE_QUESTION_URL),
      ]);

      const toFrames = (tex) => {
        tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
        const frameSize = tex.height;
        const frameCount = Math.max(1, Math.floor(tex.width / Math.max(1, frameSize)));
        const frames = [];
        for (let i = 0; i < frameCount; i++) {
          frames.push(new PIXI.Texture(
            tex.baseTexture,
            new PIXI.Rectangle(i * frameSize, 0, frameSize, frameSize)
          ));
        }
        return frames;
      };

      this._guardPortalFrames = toFrames(portalTex);
      this._agentPortalFrames = toFrames(agentPortalTex);
      this._guardIdleFrames = toFrames(idleTex);
      this._guardWalkFrames = toFrames(walkTex);
      this._guardAttackFrames = toFrames(attackTex);
      issueQuestionTex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
      this._issueQuestionTexture = issueQuestionTex;
    } catch (_) {
      this._guardPortalFrames = [];
      this._agentPortalFrames = [];
      this._guardIdleFrames = [];
      this._guardWalkFrames = [];
      this._guardAttackFrames = [];
      this._issueQuestionTexture = null;
    }
  }

  /** Populate NPCs from agent data. */
  populateNPCs(agents, events) {
    this._agents = agents;
    this._events = events;
    this._agentsById = new Map((agents || []).map((a) => [a.id, a]));
    this._indexEvents(events);
    this._meetingCooldowns.clear();
    this._renderNpcScene(agents);
    this._syncShowNpcSpriteFromScene();

    // Start game loop
    this._startLoop();
    if (this.guardEnabled) this._deployGuards(this._guardToken);
  }

  _isPendingStatus(status) {
    return status === 'pending' || status === 'waiting';
  }

  _isRunningStatus(status) {
    return status === 'working' || status === 'running' || status === 'idle';
  }

  _isSceneAgentStatus(status) {
    return this._isRunningStatus(status) || this._isPendingStatus(status);
  }

  _normalizeSceneNpcDisplayMode(mode) {
    return mode === 'capped' ? 'capped' : 'all';
  }

  _normalizeSceneNpcDisplayCap(cap) {
    return Math.max(1, Math.floor(Number(cap) || 1));
  }

  setSceneNpcDisplayConfig({ mode = this.sceneNpcDisplayMode, cap = this.sceneNpcDisplayCap } = {}) {
    const nextMode = this._normalizeSceneNpcDisplayMode(mode);
    const nextCap = this._normalizeSceneNpcDisplayCap(cap);
    if (this.sceneNpcDisplayMode === nextMode && this.sceneNpcDisplayCap === nextCap) return;
    this.sceneNpcDisplayMode = nextMode;
    this.sceneNpcDisplayCap = nextCap;
    if (!this._agents?.length) return;
    this._incrementalUpdateScene(this._agents);
    this._syncShowNpcSpriteFromScene();
  }

  _isIdleStatus(status) {
    return status === 'idle';
  }

  _allowWalkingMeetings() {
    return true;
  }

  _setIdleActivitySprite(npc, forceRefresh = false) {
    if (!npc?.sprite || !npc?.frames) return;
    const roll = forceRefresh ? Math.random() : (npc._idleActivityRoll ?? Math.random());
    npc._idleActivityRoll = Math.random();
    npc._curDir = 'idle';
    if (roll < 0.28 && npc.frames.phone.length) {
      npc.sprite.textures = npc.frames.phone;
    } else if (roll < 0.56 && npc.frames.reading.length) {
      npc.sprite.textures = npc.frames.reading;
    } else {
      npc.sprite.textures = npc.frames.idle;
    }
    npc.sprite.play();
  }

  _setWorkingPauseSprite(npc, forceRefresh = false) {
    if (!npc?.sprite || !npc?.frames) return;
    const roll = forceRefresh ? Math.random() : (npc._workingPauseRoll ?? Math.random());
    npc._workingPauseRoll = Math.random();
    npc._curDir = 'idle';
    if (roll < 0.16 && npc.frames.phone.length) {
      npc.sprite.textures = npc.frames.phone;
    } else if (roll < 0.32 && npc.frames.reading.length) {
      npc.sprite.textures = npc.frames.reading;
    } else {
      npc.sprite.textures = npc.frames.idle;
    }
    npc.sprite.play();
  }

  _queueRunningPath(npc) {
    if (!npc || !this.pathfinder) return false;
    let curTile = this.pathfinder.pixelToTile(npc.container.x, npc.container.y);
    if (!this.pathfinder.isWalkable(curTile.x, curTile.y)) {
      const near = this.pathfinder.getNearestWalkable(curTile.x, curTile.y);
      if (near) {
        const np = this.pathfinder.tileToPixel(near.x, near.y);
        npc.container.x = np.x;
        npc.container.y = np.y;
        curTile = near;
      } else {
        npc.idleTimer = 1.0;
        return false;
      }
    }

    const minDist = npc._failedPaths > 3 ? 2 : 6;
    const dest = this.pathfinder.getRandomWalkableFar(curTile.x, curTile.y, minDist);
    if (!dest) {
      npc.idleTimer = 0.4 + Math.random() * 0.5;
      return false;
    }

    const path = this.pathfinder.findPath(curTile.x, curTile.y, dest.x, dest.y);
    if (!path || path.length <= 1) {
      npc._failedPaths++;
      npc.idleTimer = 0.4 + Math.random() * 0.5;
      return false;
    }

    npc.path = path;
    npc.pathIdx = 1;
    npc.aiState = 'walking';
    npc._failedPaths = 0;
    npc._stuckFrames = 0;
    this._setNpcDir(npc);
    return true;
  }

  _updateStationary(npc, delta) {
    npc.activityTimer = (npc.activityTimer ?? (1.2 + Math.random() * 1.6)) - (delta / 60);
    if (npc.activityTimer <= 0) {
      this._setIdleActivitySprite(npc, true);
      npc.activityTimer = 2.8 + Math.random() * 4.5;
    }
  }

  _resumeNpcBehavior(npc, afterMeeting = false) {
    if (!npc) return;
    npc.meetingTimer = 0;
    npc.meetingPartner = null;
    npc.path = null;
    npc.pathIdx = 0;
    npc._stuckFrames = 0;
    npc._curDir = 'idle';

    if (npc._pendingFrozen) {
      npc.aiState = 'frozen';
      npc.sprite.textures = npc.frames.idle;
      npc.sprite.play();
      return;
    }

    if (npc.mode === 'pathfind') {
      npc.aiState = 'idle';
      npc.idleTimer = afterMeeting ? (1.5 + Math.random() * 2.0) : (1.0 + Math.random() * 2.0);
      npc.sprite.textures = npc.frames.idle;
      npc.sprite.play();
      return;
    }

    if (npc.mode === 'patrol') {
      npc.aiState = 'patrol';
      npc.movingDown = Math.random() > 0.5;
      npc.sprite.textures = npc.movingDown ? npc.frames.front : npc.frames.back;
      npc.sprite.play();
      return;
    }

    if (npc.mode === 'stationary') {
      npc.aiState = 'stationary';
      npc.activityTimer = afterMeeting ? 0.2 : 0.1;
      this._setIdleActivitySprite(npc, true);
    }
  }

  _canStartMeeting(a, b) {
    if (!a || !b || a === b) return false;
    if (a.mode === 'pending' || b.mode === 'pending') return false;
    if (a._dragActive || b._dragActive || a._pendingFrozen || b._pendingFrozen) {
      return false;
    }
    if (a.aiState === 'meeting' || b.aiState === 'meeting') return false;
    if (this._isMeetingPairCoolingDown(a, b)) return false;

    const aRunning = a.behavior === 'running';
    const bRunning = b.behavior === 'running';
    if (!aRunning && !bRunning) return false;

    const aReady = aRunning ? (a.mode === 'pathfind' ? a.aiState === 'walking' : true) : a.aiState === 'stationary';
    const bReady = bRunning ? (b.mode === 'pathfind' ? b.aiState === 'walking' : true) : b.aiState === 'stationary';
    return aReady && bReady;
  }

  _updateMeeting(npc, delta) {
    npc.meetingTimer -= delta / 60;
    if (npc.meetingTimer > 0) return;

    const partner = npc.meetingPartner;
    this._setMeetingPairCooldown(npc, partner);
    this._removeBubble(npc);

    if (partner && partner.meetingPartner === npc) {
      partner.meetingPartner = null;
      this._removeBubble(partner);
      if (partner.aiState === 'meeting') {
        this._resumeNpcBehavior(partner, true);
      }
    }

    this._resumeNpcBehavior(npc, true);
  }

  _getAgentLatestTaskTimeMs(agent) {
    if (!agent?.id) return 0;
    const latestEvent = this._getLatestEvent(agent);
    return this._getEventTimeMs(latestEvent);
  }

  _getSceneAgents(agents = []) {
    const entries = (agents || [])
      .map((agent, index) => ({
        agent,
        index,
        isPending: this._isPendingApproval(agent),
        latestTaskTimeMs: this._getAgentLatestTaskTimeMs(agent),
      }))
      .filter(({ agent }) => this._isSceneAgentStatus(agent?.status));

    const pendingEntries = entries
      .filter((entry) => entry.isPending)
      .sort((a, b) => a.index - b.index);
    const otherEntries = entries.filter((entry) => !entry.isPending);

    if (this.sceneNpcDisplayMode === 'capped') {
      otherEntries.sort((a, b) => {
        if (b.latestTaskTimeMs !== a.latestTaskTimeMs) return b.latestTaskTimeMs - a.latestTaskTimeMs;
        return a.index - b.index;
      });
      const effectiveCap = Math.max(this.sceneNpcDisplayCap, pendingEntries.length + 1);
      const remainingSlots = Math.max(0, effectiveCap - pendingEntries.length);
      return [
        ...pendingEntries,
        ...otherEntries.slice(0, remainingSlots),
      ].map((entry) => entry.agent);
    }

    return [
      ...pendingEntries,
      ...otherEntries.sort((a, b) => a.index - b.index),
    ].map((entry) => entry.agent);
  }

  _renderNpcScene(agents = []) {
    const sceneAgents = this._getSceneAgents(agents);
    const charNameMap = this._getAgentCharNameMap(agents);

    for (let i = 0; i < sceneAgents.length; i++) {
      const npc = this._createNPC(sceneAgents[i], i, charNameMap);
      if (!npc) continue;
      npc._sceneIndex = i;
      this.npcs.push(npc);
    }
  }

  _getSceneAgentIds(agents = []) {
    return this._getSceneAgents(agents)
      .map((agent) => agent.id)
      .filter(Boolean);
  }

  _shouldRebuildScene(agents = []) {
    const nextIds = new Set(this._getSceneAgentIds(agents));
    const currentIds = new Set(this.npcs.map((npc) => npc?.agent?.id).filter(Boolean));
    if (nextIds.size !== currentIds.size) return true;
    for (const id of nextIds) {
      if (!currentIds.has(id)) return true;
    }

    return false;
  }

  _removeNpc(npc) {
    if (!npc) return;
    this._removeBubble?.(npc);
    this._clearIssueVisuals?.(npc);
    npc?.container?.destroy({ children: true });
  }

  _incrementalUpdateScene(agents = []) {
    const charNameMap = this._getAgentCharNameMap(agents);
    const nextAgents = this._getSceneAgents(agents);
    const nextIds = new Set(nextAgents.map((a) => a.id).filter(Boolean));
    const nextById = new Map(nextAgents.map((a) => [a.id, a]));

    const currentById = new Map(this.npcs.map((npc) => [npc?.agent?.id, npc]).filter(([id]) => id));

    const toRemove = [];
    const kept = [];
    for (const npc of this.npcs) {
      const id = npc?.agent?.id;
      if (!id || !nextIds.has(id)) {
        toRemove.push(npc);
      } else {
        npc.agent = nextById.get(id);
        kept.push(npc);
      }
    }

    for (const npc of toRemove) {
      this._removeNpc(npc);
    }

    const usedIndices = new Set(kept.map((npc) => npc._sceneIndex).filter((i) => i != null));
    const keptIds = new Set(kept.map((npc) => npc?.agent?.id).filter(Boolean));
    const toAdd = nextAgents.filter((a) => a.id && !keptIds.has(a.id));

    const newNpcs = [];
    let freeIdx = 0;
    for (const agent of toAdd) {
      while (usedIndices.has(freeIdx)) freeIdx++;
      const npc = this._createNPC(agent, freeIdx, charNameMap);
      if (!npc) continue;
      npc._sceneIndex = freeIdx;
      usedIndices.add(freeIdx);
      kept.push(npc);
      newNpcs.push(npc);
      freeIdx++;
    }

    this.npcs = kept;
    this._syncPendingNpcStates();

    if (newNpcs.length > 0 && this._agentPortalFrames?.length) {
      for (const npc of newNpcs) {
        const isDemo = DEMO_MODE && (isDemoSession(npc.agent?.session_key) || isDemoSession(npc.agent?.id));
        if (isDemo) {
          const guard = this._getGuardPortalPoint();
          npc.container.x = guard.x;
          npc.container.y = guard.y;
          npc.container.zIndex = Math.round(guard.y);
          if (npc.homeTile && this.pathfinder) {
            npc.homeTile = this.pathfinder.pixelToTile(guard.x, guard.y);
          }
        }
        npc.container.visible = false;
        const px = npc.container.x;
        const py = npc.container.y;

        const doSpawn = () => {
          if (!npc.container || npc.container.destroyed) return;
          this._playAgentPortal(px, py, {
            onMidpoint: () => {
              if (!npc.container || npc.container.destroyed) return;
              npc.container.visible = true;
              if (isDemo && npc.frames?.phone?.length) {
                npc.sprite.textures = npc.frames.phone;
                npc.sprite.play();
                npc._curDir = 'idle';
                npc._demoPhoneTimer = 1.0;
              }
            },
          });
        };

        if (isDemo) {
          doSpawn();
        } else {
          setTimeout(doSpawn, 2000);
        }
      }
    }
  }

  _refreshNpcDataInPlace(agents = [], events = []) {
    const nextById = new Map((agents || []).map((agent) => [agent.id, agent]));
    this.npcs.forEach((npc) => {
      if (!npc?.agent?.id) return;
      const nextAgent = nextById.get(npc.agent.id);
      if (!nextAgent) return;
      npc.agent = nextAgent;
    });
    this._syncPendingNpcStates();
  }

  _clearNpcScene() {
    for (const npc of this.npcs) {
      this._removeNpc(npc);
    }
    this.npcs = [];
  }

  // ─── NPC Creation ─────────────────────────────────────────────

  _createGoldOutlineSprites(sprite, container) {
    const innerFilter = new PIXI.ColorMatrixFilter();
    innerFilter.matrix = [
      0, 0, 0, 0, 1.06,
      0, 0, 0, 0, 0.9,
      0, 0, 0, 0, 0.2,
      0, 0, 0, 1, 0,
    ];

    const outerFilter = new PIXI.ColorMatrixFilter();
    outerFilter.matrix = [
      0, 0, 0, 0, 1.12,
      0, 0, 0, 0, 0.82,
      0, 0, 0, 0, 0.18,
      0, 0, 0, 1, 0,
    ];

    const d1 = 2;
    const d2 = 5;
    const layers = [
      { offsets: [[-d2, 0], [d2, 0], [0, -d2], [0, d2]], alpha: 0.42, filter: outerFilter, layer: 'outer' },
      { offsets: [[-d1, 0], [d1, 0], [0, -d1], [0, d1], [-d1, -d1], [d1, -d1], [-d1, d1], [d1, d1]], alpha: 0.92, filter: innerFilter, layer: 'inner' },
    ];

    const clones = [];
    const insertIdx = Math.max(0, container.getChildIndex(sprite));

    for (const { offsets, alpha, filter, layer } of layers) {
      for (const [ox, oy] of offsets) {
        const clone = new PIXI.AnimatedSprite(sprite.textures);
        clone.anchor.set(sprite.anchor.x, sprite.anchor.y);
        clone.scale.set(sprite.scale.x, sprite.scale.y);
        clone.animationSpeed = sprite.animationSpeed;
        clone.filters = [filter];
        clone.alpha = alpha;
        clone.x = ox;
        clone.y = oy;
        clone._glowLayer = layer;
        clone._baseAlpha = alpha;
        clone.play();
        container.addChildAt(clone, insertIdx);
        clones.push(clone);
      }
    }
    return { clones };
  }

  _createIssueMarkerSprite() {
    if (this._issueQuestionTexture) {
      const marker = new PIXI.Sprite(this._issueQuestionTexture);
      marker.anchor.set(0.5, 1);
      marker.scale.set(ISSUE_MARKER_SCALE);
      marker.x = 0;
      marker.y = -FH * NPC_SCALE + ISSUE_MARKER_Y_OFFSET;
      marker.alpha = 0.98;
      return marker;
    }

    const marker = new PIXI.Text('?', {
      fontFamily: 'Press Start 2P',
      fontSize: Math.max(18, Math.round(12 * NPC_SCALE)),
      fill: 0xf4c95d,
      stroke: 0x5b3706,
      strokeThickness: 4,
      align: 'center',
    });
    marker.anchor.set(0.5, 1);
    marker.x = 0;
    marker.y = -FH * NPC_SCALE - 2;
    return marker;
  }

  _clearCursorStateTimer() {
    if (this._dragCursorTimer) {
      clearTimeout(this._dragCursorTimer);
      this._dragCursorTimer = null;
    }
  }

  _setCursorState(state = 'normal') {
    this.onCursorStateChange?.(state);
  }

  _playCursorSequence(states, intervalMs = 80) {
    const queue = Array.isArray(states) ? states.filter(Boolean) : [];
    this._clearCursorStateTimer();
    if (!queue.length) {
      this._setCursorState('normal');
      return;
    }
    this._setCursorState(queue[0]);
    if (queue.length === 1) return;

    let idx = 1;
    const advance = () => {
      this._setCursorState(queue[idx]);
      idx += 1;
      if (idx < queue.length) {
        this._dragCursorTimer = setTimeout(advance, intervalMs);
      } else {
        this._dragCursorTimer = null;
      }
    };
    this._dragCursorTimer = setTimeout(advance, intervalMs);
  }

  _clearNpcMeetingState(npc) {
    if (!npc) return;
    if (npc.meetingPartner) {
      const partner = npc.meetingPartner;
      this._setMeetingPairCooldown(npc, partner);
      partner.meetingPartner = null;
      if (partner.aiState === 'meeting') {
        this._resumeNpcBehavior(partner, true);
      }
      this._removeBubble(partner);
    }
    npc.meetingPartner = null;
    npc.meetingTimer = 0;
    this._removeBubble(npc);
  }

  _getNpcMeetingId(npc) {
    return npc?.agent?.id || npc?.agent?.name || npc?.charName || null;
  }

  _getMeetingPairKey(a, b) {
    const aId = this._getNpcMeetingId(a);
    const bId = this._getNpcMeetingId(b);
    if (!aId || !bId) return null;
    return [aId, bId].sort().join('::');
  }

  _isMeetingPairCoolingDown(a, b) {
    const key = this._getMeetingPairKey(a, b);
    if (!key) return false;
    const expiresAt = this._meetingCooldowns.get(key);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      this._meetingCooldowns.delete(key);
      return false;
    }
    return true;
  }

  _setMeetingPairCooldown(a, b, durationSeconds = MEETING_COOLDOWN) {
    const key = this._getMeetingPairKey(a, b);
    if (!key) return;
    this._meetingCooldowns.set(key, Date.now() + durationSeconds * 1000);
  }

  _attachNpcDragHandlers(npc, activate) {
    if (!npc?.container) return;
    npc._activate = activate;
    npc.container.on('pointerdown', (event) => this._beginNpcDrag(npc, activate, event));
  }

  _beginNpcDrag(npc, activate, event) {
    if (!npc?.container || !event?.data || this._dragContext) return;

    const originalEvent = event.data.originalEvent;
    const local = event.data.getLocalPosition(this.npcLayer);
    this._clearNpcMeetingState(npc);
    this.onNpcLeave?.();
    this._playCursorSequence(['grab-start', 'grab-full'], 90);

    npc._dragActive = false;
    npc.path = null;
    npc.pathIdx = 0;
    npc._stuckFrames = 0;
    npc._curDir = 'idle';
    if (npc.frames?.idle?.length) {
      npc.sprite.textures = npc.frames.idle;
      npc.sprite.play();
    }

    this._dragContext = {
      npc,
      activate,
      startClientX: originalEvent?.clientX ?? 0,
      startClientY: originalEvent?.clientY ?? 0,
      offsetX: local.x - npc.container.x,
      offsetY: local.y - npc.container.y,
    };

    originalEvent?.preventDefault?.();
    event.stopPropagation?.();
  }

  _handleWindowPointerMove(event) {
    const ctx = this._dragContext;
    if (!ctx?.npc || !this.app) return;

    const dx = (event.clientX ?? 0) - ctx.startClientX;
    const dy = (event.clientY ?? 0) - ctx.startClientY;
    if (!ctx.npc._dragActive && Math.sqrt(dx * dx + dy * dy) >= 6) {
      ctx.npc._dragActive = true;
      ctx.npc.container.alpha = 0.96;
      ctx.npc.container.zIndex = 9999;
      this._clearCursorStateTimer();
      this._setCursorState('grab-full');
    }
    if (!ctx.npc._dragActive) return;

    const local = this._getLayerPointFromClient(event.clientX, event.clientY);
    if (!local) return;
    const point = this._clampDropPoint(local.x - ctx.offsetX, local.y - ctx.offsetY);
    ctx.npc.container.x = point.x;
    ctx.npc.container.y = point.y;
    ctx.npc._lastX = point.x;
    ctx.npc._lastY = point.y;
  }

  _handleWindowPointerUp() {
    const ctx = this._dragContext;
    if (!ctx?.npc) return;

    const { npc } = ctx;
    this._dragContext = null;
    this._playCursorSequence(['grab-start', 'normal'], 70);

    if (npc._dragActive) {
      npc._dragActive = false;
      npc.container.alpha = 1;
      this._applyNpcDropPosition(npc, npc.container.x, npc.container.y);
      return;
    }

    npc.container.alpha = 1;
    ctx.activate?.();
  }

  _getLayerPointFromClient(clientX, clientY) {
    if (!this.app?.view || !this.world || !this.npcLayer) return null;
    const rect = this.app.view.getBoundingClientRect();
    const scale = this.world.scale.x || 1;
    const viewX = clientX - rect.left;
    const viewY = clientY - rect.top;
    const worldX = (viewX - this.world.x) / scale;
    const worldY = (viewY - this.world.y) / scale;
    return {
      x: worldX - this.npcLayer.x,
      y: worldY - this.npcLayer.y,
    };
  }

  _clampDropPoint(x, y) {
    const halfW = (FW * NPC_SCALE) / 2;
    const minY = Math.max(FH * NPC_SCALE + 8, 24);
    return {
      x: Math.max(halfW, Math.min(this.sceneW - halfW, x)),
      y: Math.max(minY, Math.min(this.sceneH, y)),
    };
  }

  _canNpcStandAt(npc, x, y) {
    if (!this.pathfinder || (npc?.mode !== 'pathfind' && npc?.mode !== 'stationary')) return true;
    const tile = this.pathfinder.pixelToTile(x, y);
    return this.pathfinder.isWalkable(tile.x, tile.y);
  }

  _getNpcFootRadius() {
    // Use a foot-circle instead of the full sprite width: the character art is
    // visually wide after scaling, but only the lower body should influence
    // crowd spacing and meeting placement.
    return Math.max(14, Math.round(FW * NPC_SCALE * 0.19));
  }

  _getNpcPersonalSpacing(a, b) {
    return this._getNpcFootRadius(a) + this._getNpcFootRadius(b) + 4;
  }

  _getNpcMeetingSpacing(a, b) {
    return Math.max(
      this._getNpcPersonalSpacing(a, b) + 18,
      Math.round(FW * NPC_SCALE * 0.6),
    );
  }

  _getNpcMeetingTriggerDistance(a, b) {
    return Math.max(MEETING_DIST, this._getNpcMeetingSpacing(a, b) - 18);
  }

  _pushNpcPairApart(a, b, targetDistance, maxCorrection = Number.POSITIVE_INFINITY) {
    if (!a?.container || !b?.container || a === b) return;
    if (a._dragActive || b._dragActive) return;

    const ax = a.container.x;
    const ay = a.container.y;
    const bx = b.container.x;
    const by = b.container.y;
    let dx = bx - ax;
    let dy = by - ay;
    let dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= targetDistance) return;

    if (dist < 0.001) {
      dx = ax <= bx ? 1 : -1;
      dy = 0;
      dist = 1;
    }

    let nx = dx / dist;
    let ny = dy / dist;

    // When characters meet on mostly vertical paths, horizontal separation
    // looks much more natural than stacking one "behind" the other.
    if (Math.abs(nx) < 0.28) {
      nx = ax <= bx ? 1 : -1;
      ny = 0;
    }

    const overlap = targetDistance - dist;
    const push = Math.min(maxCorrection, overlap / 2);
    const nextA = this._clampDropPoint(ax - nx * push, ay - ny * push);
    const nextB = this._clampDropPoint(bx + nx * push, by + ny * push);

    if (this._canNpcStandAt(a, nextA.x, nextA.y)) {
      a.container.x = nextA.x;
      a.container.y = nextA.y;
      a._lastX = nextA.x;
      a._lastY = nextA.y;
    }

    if (this._canNpcStandAt(b, nextB.x, nextB.y)) {
      b.container.x = nextB.x;
      b.container.y = nextB.y;
      b._lastX = nextB.x;
      b._lastY = nextB.y;
    }
  }

  _applyNpcCrowdSeparation() {
    for (let i = 0; i < this.npcs.length; i++) {
      const a = this.npcs[i];
      if (!a?.container || a.mode === 'pending') continue;

      for (let j = i + 1; j < this.npcs.length; j++) {
        const b = this.npcs[j];
        if (!b?.container || b.mode === 'pending') continue;

        const sameMeeting = a.meetingPartner === b && b.meetingPartner === a;
        const targetDistance = sameMeeting
          ? this._getNpcMeetingSpacing(a, b)
          : this._getNpcPersonalSpacing(a, b);
        const maxCorrection = sameMeeting ? 8 : 2.8;
        this._pushNpcPairApart(a, b, targetDistance, maxCorrection);
      }
    }
  }

  _findNearestWalkableTile(tx, ty, maxRadius = 16) {
    if (!this.pathfinder) return null;
    if (this.pathfinder.isWalkable(tx, ty)) return { x: tx, y: ty };

    let best = null;
    let bestDist = Infinity;
    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let y = ty - radius; y <= ty + radius; y++) {
        for (let x = tx - radius; x <= tx + radius; x++) {
          if (!this.pathfinder.isWalkable(x, y)) continue;
          const dist = Math.abs(x - tx) + Math.abs(y - ty);
          if (dist < bestDist) {
            best = { x, y };
            bestDist = dist;
          }
        }
      }
      if (best) return best;
    }
    return this.pathfinder.getRandomWalkable();
  }

  _resolveNpcDropPosition(npc, x, y) {
    const clamped = this._clampDropPoint(x, y);
    if (this.pathfinder && (npc.mode === 'pathfind' || npc.mode === 'stationary')) {
      let tile = this.pathfinder.pixelToTile(clamped.x, clamped.y);
      if (!this.pathfinder.isWalkable(tile.x, tile.y)) {
        tile = this._findNearestWalkableTile(tile.x, tile.y);
      }
      if (tile) {
        const point = this.pathfinder.tileToPixel(tile.x, tile.y);
        return { x: point.x, y: point.y, tile };
      }
    }
    return { x: clamped.x, y: clamped.y, tile: null };
  }

  _applyNpcDropPosition(npc, x, y) {
    if (!npc?.container) return;
    const drop = this._resolveNpcDropPosition(npc, x, y);
    npc.container.x = drop.x;
    npc.container.y = drop.y;
    npc.container.zIndex = Math.round(drop.y);
    npc._lastX = drop.x;
    npc._lastY = drop.y;
    npc.path = null;
    npc.pathIdx = 0;
    npc._stuckFrames = 0;
    npc._failedPaths = 0;

    if (npc.mode === 'pathfind') {
      npc.homeTile = drop.tile || this.pathfinder.pixelToTile(drop.x, drop.y);
      npc.aiState = npc._pendingFrozen ? 'frozen' : 'idle';
      npc.idleTimer = 0.08 + Math.random() * 0.15;
      npc._curDir = 'idle';
      npc.sprite.textures = npc.frames.idle;
      npc.sprite.play();
      return;
    }

    if (npc.mode === 'patrol') {
      npc.xBase = drop.x;
      npc.zone = {
        ...npc.zone,
        x: drop.x,
        yA: Math.max(FH * NPC_SCALE + 8, drop.y - 54),
        yB: Math.min(this.sceneH, drop.y + 54),
      };
      if (npc._pendingFrozen) {
        npc.sprite.textures = npc.frames.idle;
      } else {
        npc.movingDown = Math.random() > 0.5;
        npc.sprite.textures = npc.movingDown ? npc.frames.front : npc.frames.back;
      }
      npc.sprite.play();
      return;
    }

    if (npc.mode === 'stationary') {
      npc.aiState = 'stationary';
      npc.activityTimer = 0.1;
      this._setIdleActivitySprite(npc, true);
      return;
    }

    npc.sprite.textures = npc.frames?.idle?.length ? npc.frames.idle : npc.sprite.textures;
    npc.sprite.play?.();
  }

  _isPendingApproval(agent) {
    if (!agent) return false;
    const latest = this._agentsById.get(agent.id) || agent;
    return this._isPendingStatus(latest.status) || this._waitingAgents.has(agent.id);
  }

  _ensureIssueVisuals(npc) {
    if (!npc) return;
    if (!npc.emoteSprite) {
      const marker = this._createIssueMarkerSprite();
      npc.container.addChild(marker);
      npc.emoteSprite = marker;
    }
    if (!npc.goldOutlines && npc.sprite) {
      npc.goldOutlines = this._createGoldOutlineSprites(npc.sprite, npc.container);
    }
  }

  _syncGoldOutlineTextures(npc) {
    if (!npc?.goldOutlines?.clones?.length || !npc?.sprite) return;
    const currentTex = npc.sprite.textures;
    const currentFrame = npc.sprite.currentFrame;
    for (const clone of npc.goldOutlines.clones) {
      if (clone.textures !== currentTex) {
        clone.textures = currentTex;
        clone.gotoAndPlay(currentFrame);
      }
      clone.scale.set(npc.sprite.scale.x, npc.sprite.scale.y);
    }
  }

  _syncIssueAuraPulse(npc, now = Date.now(), strength = 1) {
    if (!npc?.goldOutlines?.clones?.length) return;
    const breathe = Math.sin(now / 600) * 0.5 + 0.5;
    const flicker = Math.sin(now / 170) * 0.12;
    for (const clone of npc.goldOutlines.clones) {
      const base = clone._baseAlpha ?? 0.7;
      if (clone._glowLayer === 'outer') {
        clone.alpha = Math.min(1, base * (0.78 + breathe * 0.92 + flicker * 1.1) * strength);
      } else {
        clone.alpha = Math.min(1, base * (0.96 + breathe * 0.48 + flicker * 0.65) * strength);
      }
    }
    this._syncGoldOutlineTextures(npc);
  }

  _clearIssueVisuals(npc) {
    if (!npc) return;
    if (npc.goldOutlines?.clones) {
      for (const clone of npc.goldOutlines.clones) {
        if (clone.parent) clone.parent.removeChild(clone);
        clone.destroy();
      }
      npc.goldOutlines = null;
    }
    if (npc.emoteSprite) {
      if (npc.emoteSprite.parent) npc.emoteSprite.parent.removeChild(npc.emoteSprite);
      npc.emoteSprite.destroy();
      npc.emoteSprite = null;
    }
  }

  _setPendingNpcState(npc, shouldFreeze) {
    if (!npc) return;
    npc._pendingFrozen = shouldFreeze;
    npc.hasIssue = shouldFreeze;

    if (shouldFreeze) {
      if (npc.meetingPartner) {
        const partner = npc.meetingPartner;
        this._setMeetingPairCooldown(npc, partner);
        partner.meetingPartner = null;
        if (partner.aiState === 'meeting') {
          this._resumeNpcBehavior(partner, true);
        }
        this._removeBubble(partner);
      }
      npc.meetingPartner = null;
      npc.meetingTimer = 0;
      this._removeBubble(npc);
      if (npc.mode === 'pathfind') {
        npc.aiState = 'frozen';
        npc.path = null;
      }
      npc.sprite.textures = npc.frames.idle;
      npc.sprite.play();
      this._ensureIssueVisuals(npc);
      return;
    }

    this._clearIssueVisuals(npc);
    npc.hasIssue = false;

    if (npc.mode === 'pathfind') {
      npc.aiState = 'idle';
      npc.idleTimer = 0.6 + Math.random() * 1.2;
    }
  }

  _syncPendingNpcStates() {
    for (const npc of this.npcs) {
      if (!npc?.agent) continue;
      const shouldFreeze = this._isPendingApproval(npc.agent);
      if (shouldFreeze !== Boolean(npc._pendingFrozen)) {
        this._setPendingNpcState(npc, shouldFreeze);
      } else if (shouldFreeze) {
        npc.hasIssue = true;
        this._ensureIssueVisuals(npc);
      }
    }
  }

  _createNPC(agent, idx, charNameMap = null) {
    const charName = charNameMap?.[agent?.id] || CHAR_NAMES[idx % CHAR_NAMES.length];
    const frames   = this.spriteLoader.charFrames[charName];
    if (!frames || !frames.front.length) return null;
    const isRunner = this._isSceneAgentStatus(agent?.status);
    const state = this._getAgentState(agent);

    const container = new PIXI.Container();

    // Shadow
    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.12);
    shadow.drawEllipse(0, -1, 10 * NPC_SCALE, 3 * NPC_SCALE);
    shadow.endFill();
    container.addChild(shadow);

    // Animated sprite
    const movingDown = Math.random() > 0.5;
    const sprite = new PIXI.AnimatedSprite(movingDown ? frames.front : frames.back);
    sprite.animationSpeed = 0.15;
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(NPC_SCALE);
    sprite.play();
    container.addChild(sprite);

    // Name tag
    const nameTagColor = 0x7fb9ff;
    const nameTag  = new PIXI.Text(agent.name.replace(/^Agent-/, '').substring(0, 10), {
      fontFamily: 'Press Start 2P', fontSize: 20, fill: nameTagColor, align: 'center', stroke: 0x120d1c, strokeThickness: 2,
    });
    nameTag.anchor.set(0.5, 1);
    nameTag.y = -FH * NPC_SCALE - 2;
    container.addChild(nameTag);

    // Issue marker
    let emoteSprite = null;
    const hasPendingApproval = this._isPendingApproval(agent);
    const hasIssue = hasPendingApproval;
    if (hasIssue) {
      emoteSprite = this._createIssueMarkerSprite();
      container.addChild(emoteSprite);
    }

    // Interactive
    container.eventMode = 'static';
    container.cursor    = 'pointer';
    const hw = FW * NPC_SCALE, hh = FH * NPC_SCALE;
    container.hitArea = new PIXI.Rectangle(-hw / 2, -hh, hw, hh);

    let _goldOutlines = null;

    container.on('pointerover', () => {
      if (this._dragContext) return;
      const pendingNow = this._isPendingApproval(agent);
      const gp = container.getGlobalPosition();
      const rect = this.app.view.getBoundingClientRect();
      this.onNpcHover?.({
        agent, charName, state,
        snippet: this._getSnippet(agent),
        event: this._getLatestEvent(agent),
        isPending: pendingNow,
      }, {
        x: rect.left + gp.x,
        y: Math.max(4, rect.top + gp.y - FH * NPC_SCALE * this.world.scale.x - 16),
      });
    });
    container.on('pointerout', () => this.onNpcLeave?.());

    this.npcLayer.addChild(container);

    // Build NPC object
    let npcObj;
    if (this.pathfinder) {
      const workstations = this.tiledRenderer ? this.tiledRenderer.getWorkstations() : [];
      let startPx;
      if (workstations[idx]) {
        startPx = { x: workstations[idx].x, y: workstations[idx].y };
      } else {
        // Spread NPCs apart
        let bestTile = null;
        for (let attempt = 0; attempt < 20; attempt++) {
          const tile = this.pathfinder.getRandomWalkable();
          if (!tile) break;
          const px = this.pathfinder.tileToPixel(tile.x, tile.y);
          let minDist = Infinity;
          for (const existing of this.npcs) {
            if (!existing) continue;
            const dx = px.x - existing.container.x;
            const dy = px.y - existing.container.y;
            minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
          }
          if (!bestTile || minDist > bestTile.dist) {
            bestTile = { tile, dist: minDist };
          }
        }
        if (bestTile) {
          startPx = this.pathfinder.tileToPixel(bestTile.tile.x, bestTile.tile.y);
        } else {
          const tile = this.pathfinder.getRandomWalkable();
          startPx = tile ? this.pathfinder.tileToPixel(tile.x, tile.y) : { x: this.sceneW / 2, y: this.sceneH / 2 };
        }
      }

      container.x = startPx.x;
      container.y = startPx.y;
      container.zIndex = Math.round(startPx.y);

      npcObj = {
        agent, container, sprite, frames, charName, emoteSprite,
        goldOutlines: _goldOutlines, hasIssue,
        _originalHasIssue: hasIssue, _pendingFrozen: hasPendingApproval,
        mode: isRunner ? 'pathfind' : 'stationary',
        behavior: isRunner ? 'running' : 'idle',
        speed: 0.45 + Math.random() * 0.25,
        aiState: hasPendingApproval ? 'frozen' : (isRunner ? 'idle' : 'stationary'), _curDir: 'idle',
        idleTimer: isRunner ? (1.0 + Math.random() * 3.0) : 0,
        activityTimer: isRunner ? 0 : (0.1 + Math.random() * 0.4),
        path: null, pathIdx: 0,
        homeTile: this.pathfinder.pixelToTile(startPx.x, startPx.y),
        _failedPaths: 0, _stuckFrames: 0,
        _lastX: startPx.x, _lastY: startPx.y,
        meetingTimer: 0, meetingPartner: null, bubble: null,
      };
      if (hasPendingApproval) {
        npcObj.sprite.textures = npcObj.frames.idle;
        npcObj.sprite.play();
      } else if (!isRunner) {
        this._setIdleActivitySprite(npcObj, true);
      }
    } else {
      // Static patrol mode
      const zone    = WALK_ZONES[idx % WALK_ZONES.length];
      const xOffset = Math.floor(idx / WALK_ZONES.length) * 10;
      const startY  = zone.yA + Math.random() * (zone.yB - zone.yA);
      container.x     = zone.x + xOffset;
      container.y     = startY;
      container.zIndex = Math.round(startY);

      npcObj = {
        agent, container, sprite, frames, charName, emoteSprite,
        goldOutlines: _goldOutlines, hasIssue,
        _originalHasIssue: hasIssue, _pendingFrozen: hasPendingApproval,
        mode: isRunner ? 'patrol' : 'stationary',
        behavior: isRunner ? 'running' : 'idle',
        speed: 0.32 + Math.random() * 0.38,
        movingDown,
        zone, xBase: zone.x + xOffset,
        aiState: isRunner ? 'patrol' : 'stationary',
        activityTimer: isRunner ? 0 : (0.1 + Math.random() * 0.4),
      };
      if (hasPendingApproval) {
        npcObj.sprite.textures = npcObj.frames.idle;
        npcObj.sprite.play();
      } else if (!isRunner) {
        this._setIdleActivitySprite(npcObj, true);
      }
    }

    if (hasPendingApproval) this._ensureIssueVisuals(npcObj);

    this._attachNpcDragHandlers(npcObj, () => {
      const pendingNow = this._isPendingApproval(agent);
      this.onNpcClick?.({
        agent, charName, state,
        snippet: this._getSnippet(agent),
        event: this._getLatestEvent(agent),
        events: this._eventsByAgent.get(agent.id) || [],
        isPending: pendingNow,
      });
    });

    return npcObj;
  }

  _createPendingNPC() {
    const charName = 'Edward';
    const frames = this.spriteLoader.charFrames[charName];
    if (!frames || !frames.idle.length) return null;

    const container = new PIXI.Container();

    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.12);
    shadow.drawEllipse(0, -1, 10 * NPC_SCALE, 3 * NPC_SCALE);
    shadow.endFill();
    container.addChild(shadow);

    const sprite = new PIXI.AnimatedSprite(frames.idle);
    sprite.animationSpeed = 0.08;
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(NPC_SCALE);
    sprite.play();

    const goldOutlines = null;
    container.addChild(sprite);

    const emoteSprite = this._createIssueMarkerSprite();
    container.addChild(emoteSprite);

    const label = new PIXI.Text('PENDING', {
      fontFamily: 'Press Start 2P', fontSize: 4, fill: 0xF59E0B, align: 'center',
    });
    label.anchor.set(0.5, 1);
    label.y = -FH * NPC_SCALE - 16;
    container.addChild(label);

    if (this.pathfinder) {
      const tile = this.pathfinder.getRandomWalkable();
      if (tile) {
        const px = this.pathfinder.tileToPixel(tile.x, tile.y);
        container.x = px.x; container.y = px.y;
      } else {
        container.x = this.sceneW / 2; container.y = this.sceneH / 2;
      }
    } else {
      container.x = 240; container.y = 305;
    }
    container.zIndex = Math.round(container.y);

    container.eventMode = 'static';
    container.hitArea   = new PIXI.Rectangle(-20, -FH * NPC_SCALE, 40, FH * NPC_SCALE);

    // Hover shows tooltip too
    container.on('pointerover', () => {
      if (this._dragContext) return;
      const gp = container.getGlobalPosition();
      const rect = this.app.view.getBoundingClientRect();
      this.onNpcHover?.({
        agent: { name: 'Agent-Edward', id: 'pending-edward', status: 'pending',
                 provider: 'OpenAI', model: 'gpt-4', pid: '—' },
        charName, state: 'pending',
        snippet: 'Waiting for permission: execute_shell_command',
        event: { event_type: 'permission_request', duration: 120 },
        isPending: true,
      }, {
        x: rect.left + gp.x,
        y: Math.max(4, rect.top + gp.y - FH * NPC_SCALE * this.world.scale.x - 16),
      });
    });
    container.on('pointerout', () => this.onNpcLeave?.());

    this.npcLayer.addChild(container);
    const pendingNpc = {
      container,
      sprite,
      goldOutlines,
      emoteSprite,
      charName,
      mode: 'pending',
      _dragActive: false,
      _pendingFrozen: true,
      meetingTimer: 0,
      meetingPartner: null,
    };
    this._ensureIssueVisuals(pendingNpc);
    this._attachNpcDragHandlers(pendingNpc, () => this.onPendingClick?.());
    return pendingNpc;
  }

  // ─── Speech Bubbles ──────────────────────────────────────────

  /**
   * @param {'meeting' | 'fieldResponse'} variant
   *   meeting — two NPCs chatting (wider min box);
   *   fieldResponse — short line after double-tap `filed_npc` with `response`.
   */
  _createBubble(npc, text, variant = 'meeting') {
    if (npc.bubble) this._removeBubble(npc);

    const compact = variant === 'fieldResponse';
    const fontSize = compact ? FIELD_RESPONSE_BUBBLE_FONT_SIZE : MEETING_BUBBLE_FONT_SIZE;
    const lineHeight = compact ? FIELD_RESPONSE_BUBBLE_LINE_HEIGHT : MEETING_BUBBLE_LINE_HEIGHT;
    const wordWrap = compact ? FIELD_RESPONSE_BUBBLE_WORD_WRAP : MEETING_BUBBLE_WORD_WRAP;
    const pad = compact ? FIELD_RESPONSE_BUBBLE_PAD : MEETING_BUBBLE_PAD;
    const minW = compact ? FIELD_RESPONSE_BUBBLE_MIN_W : MEETING_BUBBLE_MIN_W;
    const minH = compact ? FIELD_RESPONSE_BUBBLE_MIN_H : MEETING_BUBBLE_MIN_H;
    const corner = compact ? FIELD_RESPONSE_BUBBLE_CORNER : MEETING_BUBBLE_CORNER;

    const bc = new PIXI.Container();
    const truncated = text.length > BUBBLE_MAX_CHARS ? text.substring(0, BUBBLE_MAX_CHARS) + '…' : text;
    const bt = new PIXI.Text(truncated, {
      fontFamily: 'Press Start 2P',
      fontSize,
      fill: 0x3a3020,
      wordWrap: true,
      wordWrapWidth: wordWrap,
      lineHeight,
      align: 'center',
    });
    bt.anchor.set(0.5, 1);

    const bg = new PIXI.Graphics();
    bg.beginFill(0xFFFDF8, 0.94);
    bg.lineStyle(1, 0xB2773F, 0.6);
    const bw = Math.max(minW, bt.width + pad * 2);
    const bh = Math.max(minH, bt.height + pad * 2);
    bg.drawRoundedRect(-bw / 2, -bh, bw, bh, corner);
    bg.endFill();
    bg.beginFill(0xFFFDF8, 0.94);
    const triW = compact ? 10 : 12;
    const triH = compact ? 13 : 15;
    bg.moveTo(-triW, 0); bg.lineTo(0, triH); bg.lineTo(triW, 0);
    bg.endFill();

    bt.y = -pad;
    bc.addChild(bg); bc.addChild(bt);
    bc.y = MEETING_BUBBLE_ANCHOR_Y;
    bc.alpha = 0;
    npc.container.addChild(bc);
    npc.bubble = bc;
    npc._bubbleFadeIn = true;
  }

  _removeBubble(npc) {
    if (npc.bubble) {
      npc.container.removeChild(npc.bubble);
      npc.bubble.destroy({ children: true });
      npc.bubble = null;
    }
  }

  // ─── Field NPC (`filed_npc` layer) dialogue ─────────────────

  _setupFieldNpcDialogueLayer() {
    this._destroyFieldNpcDialogueLayer();
    if (!this.world || !this.tiledRenderer || !this.app) return;

    const layer = new PIXI.Container();
    layer.zIndex = 40;
    layer.eventMode = 'static';
    layer.cursor = 'default';
    layer.hitArea = new PIXI.Rectangle(0, 0, this.sceneW, this.sceneH);
    layer.x = this._worldOffsetX;
    layer.y = this._worldOffsetY;
    layer.on('pointertap', (e) => this._onFieldNpcLayerPointerTap(e));

    this.world.addChild(layer);
    this._fieldNpcDialogueHitLayer = layer;
  }

  _destroyFieldNpcDialogueLayer() {
    if (this._fieldNpcDialogueHitLayer?.parent) {
      this._fieldNpcDialogueHitLayer.parent.removeChild(this._fieldNpcDialogueHitLayer);
    }
    this._fieldNpcDialogueHitLayer?.destroy({ children: false });
    this._fieldNpcDialogueHitLayer = null;
  }

  _onFieldNpcLayerPointerTap(event) {
    if (this._dragContext || !this.tiledRenderer) return;
    const local = event.data.getLocalPosition(this._fieldNpcDialogueHitLayer);
    if (!this.tiledRenderer.isFieldNpcTileAtMapPixel(local.x, local.y)) {
      this._lastFieldNpcTapAt = 0;
      return;
    }
    const now = performance.now();
    if (now - this._lastFieldNpcTapAt > SHOW_EASTER_EGG_DOUBLE_TAP_MS) {
      this._lastFieldNpcTapAt = now;
      return;
    }
    this._lastFieldNpcTapAt = 0;
    this._triggerFieldNpcDialogue(local.x, local.y);
  }

  _cancelFieldNpcDialogue() {
    this._fieldDialogueToken++;
    if (this._fieldDialogueNpcTimer) {
      clearTimeout(this._fieldDialogueNpcTimer);
      this._fieldDialogueNpcTimer = null;
    }
    if (this._fieldDialogueFloatTimer) {
      clearTimeout(this._fieldDialogueFloatTimer);
      this._fieldDialogueFloatTimer = null;
    }

    if (this._fieldDialogueFloatBubble?.parent) {
      this._fieldDialogueFloatBubble.parent.removeChild(this._fieldDialogueFloatBubble);
      this._fieldDialogueFloatBubble.destroy({ children: true });
      this._fieldDialogueFloatBubble = null;
    }

    const npc = this._fieldDialogueLockedNpc;
    const snap = this._fieldDialogueNpcSnap;
    this._fieldDialogueLockedNpc = null;
    this._fieldDialogueNpcSnap = null;

    if (npc?.sprite && snap?.textures) {
      npc.sprite.textures = snap.textures;
      npc._curDir = snap.curDir;
      npc.sprite.play();
      this._removeBubble(npc);
      npc._fieldDialogueLock = false;
    }

    this._resetCreatorEasterEggResponse();
  }

  _createFieldNpcFloatingLabel(mapX, mapY, text) {
    const raw = String(text || '').trim();
    if (!raw || !this.npcLayer) return;

    const bc = new PIXI.Container();
    bc.zIndex = 15000;
    bc.x = mapX;
    bc.y = mapY - FIELD_NPC_FLOAT_OFFSET_Y;

    const truncated = raw.length > BUBBLE_MAX_CHARS ? `${raw.slice(0, BUBBLE_MAX_CHARS)}…` : raw;
    const bt = new PIXI.Text(truncated, {
      fontFamily: 'Press Start 2P',
      fontSize: FIELD_NPC_FLOAT_FONT_SIZE,
      fill: 0x3a3020,
      wordWrap: true,
      wordWrapWidth: FIELD_NPC_FLOAT_WORD_WRAP,
      lineHeight: FIELD_NPC_FLOAT_LINE_HEIGHT,
      align: 'center',
    });
    bt.anchor.set(0.5, 1);

    const pad = FIELD_NPC_FLOAT_PAD;
    const bg = new PIXI.Graphics();
    bg.beginFill(0xFFFDF8, 0.95);
    bg.lineStyle(1, 0xB2773F, 0.55);
    const bw = Math.max(FIELD_NPC_FLOAT_MIN_W, bt.width + pad * 2);
    const bh = Math.max(FIELD_NPC_FLOAT_MIN_H, bt.height + pad * 2);
    bg.drawRoundedRect(-bw / 2, -bh, bw, bh, FIELD_NPC_FLOAT_CORNER);
    bg.endFill();
    bg.beginFill(0xFFFDF8, 0.95);
    bg.moveTo(-11, 0); bg.lineTo(0, 14); bg.lineTo(11, 0);
    bg.endFill();

    bt.y = -pad;
    bc.addChild(bg);
    bc.addChild(bt);
    this.npcLayer.addChild(bc);
    this._fieldDialogueFloatBubble = bc;
  }

  _triggerFieldNpcDialogue(mapX, mapY) {
    this._cancelFieldNpcDialogue();
    const lines = this._fieldDialogueLines;
    if (!this.npcLayer || !Array.isArray(lines) || !lines.length) return;

    const entry = lines[Math.floor(Math.random() * lines.length)] || {};
    const lineText = String(entry.text || '').trim();
    const response = String(entry.response || '').trim();
    if (!lineText && !response) return;

    const token = this._fieldDialogueToken;
    if (lineText) this._createFieldNpcFloatingLabel(mapX, mapY, lineText);

    this._fieldDialogueFloatTimer = window.setTimeout(() => {
      if (token !== this._fieldDialogueToken) return;
      if (this._fieldDialogueFloatBubble?.parent) {
        this._fieldDialogueFloatBubble.parent.removeChild(this._fieldDialogueFloatBubble);
        this._fieldDialogueFloatBubble.destroy({ children: true });
        this._fieldDialogueFloatBubble = null;
      }
    }, FIELD_NPC_FLOAT_LABEL_MS);

    if (!response) return;

    if (this.creatorEasterEggs?.length) {
      this._triggerCreatorEasterEggResponse(response);
    } else {
      this._triggerShowEasterEggMessage(mapX, mapY, response);
    }
  }

  // ─── Game Loop ──────────────────────────────────────────────

  _startLoop() {
    this.app.ticker.add((delta) => {
      // ── Meeting detection ──
      if (this._allowWalkingMeetings()) {
        for (let i = 0; i < this.npcs.length; i++) {
          const a = this.npcs[i];
          if (!a) continue;
          for (let j = i + 1; j < this.npcs.length; j++) {
            const b = this.npcs[j];
            if (!b || !this._canStartMeeting(a, b)) continue;
            const dx = a.container.x - b.container.x;
            const dy = a.container.y - b.container.y;
            if (Math.sqrt(dx * dx + dy * dy) < this._getNpcMeetingTriggerDistance(a, b)) {
              this._startMeeting(a, b);
            }
          }
        }
      }

      // ── Update each NPC ──
      for (const npc of this.npcs) {
        if (!npc) continue;

        if (npc._demoPhoneTimer > 0) {
          npc._demoPhoneTimer -= delta / 60;
          if (npc._demoPhoneTimer <= 0) {
            npc._demoPhoneTimer = 0;
            if (npc.frames?.idle?.length) {
              npc.sprite.textures = npc.frames.idle;
              npc.sprite.play();
              npc._curDir = 'idle';
            }
            if (npc.mode === 'pathfind') {
              npc.aiState = 'idle';
              npc.idleTimer = 0.1;
            }
          } else {
            continue;
          }
        }

        // Bubble fade
        if (npc.bubble && npc._bubbleFadeIn) {
          npc.bubble.alpha = Math.min(1, npc.bubble.alpha + 0.05);
          if (npc.bubble.alpha >= 1) npc._bubbleFadeIn = false;
        }

        if (npc.aiState === 'meeting') {
          this._updateMeeting(npc, delta);
        } else if (npc._fieldDialogueLock) {
          // Held for field-NPC response; no movement until timeout restores pose.
        } else if (npc._dragActive || npc._pendingFrozen) {
          // Frozen — stay in place
        } else if (npc.mode === 'patrol') {
          this._updatePatrol(npc, delta);
        } else if (npc.mode === 'pathfind' && this.pathfinder) {
          this._updatePathfind(npc, delta);
        } else if (npc.mode === 'stationary') {
          this._updateStationary(npc, delta);
        }
      }

      this._applyNpcCrowdSeparation();

      for (const npc of this.npcs) {
        if (!npc) continue;
        npc.container.zIndex = Math.round(npc.container.y);
        this._syncIssueAuraPulse(npc, Date.now(), npc._pendingFrozen ? 1.35 : 0.8);

        if (npc.emoteSprite) {
          const bob = Math.sin(Date.now() / 240) * 5;
          const pulse = Math.sin(Date.now() / 220) * 0.08 + 0.98;
          npc.emoteSprite.y = -FH * NPC_SCALE + ISSUE_MARKER_Y_OFFSET + bob;
          npc.emoteSprite.scale.set(ISSUE_MARKER_SCALE * pulse);
          npc.emoteSprite.alpha = Math.sin(Date.now() / 260) * 0.08 + 0.94;
        }
      }

      // Pending NPC: keep a gentle glow + marker pulse
      if (this.pendingNpc) {
        this.pendingNpc.container.alpha = Math.sin(Date.now() / 500) * 0.12 + 0.88;
        this._syncIssueAuraPulse(this.pendingNpc, Date.now(), 1.55);
        if (this.pendingNpc.emoteSprite) {
          const bob = Math.sin(Date.now() / 240) * 5;
          const pulse = Math.sin(Date.now() / 220) * 0.08 + 0.98;
          this.pendingNpc.emoteSprite.y = -FH * NPC_SCALE + ISSUE_MARKER_Y_OFFSET + bob;
          this.pendingNpc.emoteSprite.scale.set(ISSUE_MARKER_SCALE * pulse);
          this.pendingNpc.emoteSprite.alpha = Math.sin(Date.now() / 260) * 0.08 + 0.94;
        }
      }

      // Guard units
      this._updateGuards(delta);
      this._syncFloorScreenOverlay(performance.now());
      this._syncWallDashboardOverlay(performance.now());
      this._syncShowEasterEggOverlay(performance.now());
      this._syncCreatorEasterEggOverlay(performance.now());
    });
  }

  _startMeeting(a, b) {
    if (this._isMeetingPairCoolingDown(a, b)) return;
    a.path = null;
    b.path = null;
    a.pathIdx = 0;
    b.pathIdx = 0;
    a.aiState = 'meeting'; b.aiState = 'meeting';
    a.meetingTimer = MEETING_TIME; b.meetingTimer = MEETING_TIME;
    a.meetingPartner = b; b.meetingPartner = a;
    this._pushNpcPairApart(a, b, this._getNpcMeetingSpacing(a, b));

    if (a.container.x < b.container.x) {
      a._curDir = 'right_idle';
      a.sprite.textures = a.frames.idleRight.length ? a.frames.idleRight : a.frames.idle;
      b._curDir = 'left_idle';
      b.sprite.textures = b.frames.idleLeft.length ? b.frames.idleLeft : b.frames.idle;
    } else {
      a._curDir = 'left_idle';
      a.sprite.textures = a.frames.idleLeft.length ? a.frames.idleLeft : a.frames.idle;
      b._curDir = 'right_idle';
      b.sprite.textures = b.frames.idleRight.length ? b.frames.idleRight : b.frames.idle;
    }
    a.sprite.play(); b.sprite.play();

    this._createBubble(a, this._getSnippet(a.agent) || a.agent.name + ' working...');
    this._createBubble(b, this._getSnippet(b.agent) || b.agent.name + ' working...');

    const baseY = MEETING_BUBBLE_ANCHOR_Y;
    const sx = MEETING_BUBBLE_SPREAD_X;
    const sy = MEETING_BUBBLE_STAGGER_Y;
    if (a.container.x <= b.container.x) {
      a.bubble.x = -sx;
      b.bubble.x = sx;
      a.bubble.y = baseY - sy;
      b.bubble.y = baseY + sy;
    } else {
      a.bubble.x = sx;
      b.bubble.x = -sx;
      a.bubble.y = baseY + sy;
      b.bubble.y = baseY - sy;
    }
  }

  _updatePatrol(npc, delta) {
    const step = npc.speed * delta;
    if (npc.movingDown) {
      npc.container.y += step;
      if (npc.container.y >= npc.zone.yB) {
        npc.container.y = npc.zone.yB;
        npc.movingDown  = false;
        npc.sprite.textures = npc.frames.back;
        npc.sprite.play();
      }
    } else {
      npc.container.y -= step;
      if (npc.container.y <= npc.zone.yA) {
        npc.container.y = npc.zone.yA;
        npc.movingDown  = true;
        npc.sprite.textures = npc.frames.front;
        npc.sprite.play();
      }
    }
  }

  _updatePathfind(npc, delta) {
    switch (npc.aiState) {
      case 'idle':
        npc.idleTimer -= delta / 60;
        if (npc.idleTimer <= 0) {
          this._queueRunningPath(npc);
        }
        break;

      case 'walking': {
        if (!npc.path || npc.pathIdx >= npc.path.length) {
          npc.aiState = 'idle';
          npc.idleTimer = 2.0 + Math.random() * 4.0;
          npc._curDir = 'idle'; npc._failedPaths = 0;
          npc._stuckFrames = 0;
          this._setWorkingPauseSprite(npc, true);
          break;
        }

        const target = npc.path[npc.pathIdx];
        const tpx    = this.pathfinder.tileToPixel(target.x, target.y);
        const dx     = tpx.x - npc.container.x;
        const dy     = tpx.y - npc.container.y;
        const dist   = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1) {
          npc.container.x = tpx.x; npc.container.y = tpx.y;
          npc.pathIdx++;
          npc._stuckFrames = 0;
        } else {
          // Stuck detection: only while actively walking
          const mdx = npc.container.x - npc._lastX;
          const mdy = npc.container.y - npc._lastY;
          if (mdx * mdx + mdy * mdy < 0.01) {
            npc._stuckFrames++;
          } else {
            npc._stuckFrames = 0;
          }
        }
        npc._lastX = npc.container.x;
        npc._lastY = npc.container.y;

        if (npc._stuckFrames > 90) {
          npc._stuckFrames = 0;
          npc._failedPaths++;
          if (npc._failedPaths > 6) {
            npc.aiState = 'idle';
            npc.idleTimer = 0.8 + Math.random() * 1.2;
            npc.path = null;
            npc._failedPaths = 0;
            this._setWorkingPauseSprite(npc, true);
            break;
          }
          const rerouted = this._queueRunningPath(npc);
          if (!rerouted) {
            npc.aiState = 'idle';
            npc.idleTimer = 0.3 + Math.random() * 0.4;
            npc.path = null;
            this._setWorkingPauseSprite(npc, true);
          }
          break;
        }

        this._setNpcDir(npc);

        if (dist >= 1) {
          const step = Math.min(npc.speed * delta, dist);
          npc.container.x += (dx / dist) * step;
          npc.container.y += (dy / dist) * step;
        }
        break;
      }

      case 'meeting':
        npc.meetingTimer -= delta / 60;
        if (npc.meetingTimer <= 0) {
          this._setMeetingPairCooldown(npc, npc.meetingPartner);
          this._removeBubble(npc);
          npc.aiState = 'idle'; npc.idleTimer = 1.5 + Math.random() * 2.5;
          npc._curDir = 'idle'; npc._failedPaths = 0;
          this._setWorkingPauseSprite(npc, true);
          npc.meetingPartner = null;
        }
        break;
    }
  }

  _setNpcDir(npc) {
    if (!npc.path || npc.pathIdx >= npc.path.length) return;
    const target = npc.path[npc.pathIdx];
    const tpx = this.pathfinder.tileToPixel(target.x, target.y);
    const dx  = tpx.x - npc.container.x;
    const dy  = tpx.y - npc.container.y;
    const dir = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'front' : 'back') : (dx > 0 ? 'right' : 'left');
    if (npc._curDir !== dir) {
      npc._curDir = dir;
      npc.sprite.textures = npc.frames[dir];
      npc.sprite.play();
    }
  }

  setGuardEnabled(enabled) {
    const next = !!enabled;
    if (this.guardEnabled === next) return;
    this.guardEnabled = next;
    this._guardToken++;
    const token = this._guardToken;
    if (next) {
      this._guardPendingSnapshot.clear();
      this._deployGuards(token);
    } else {
      this._guardPendingSnapshot.clear();
      this._startRecallGuards();
    }
  }

  _getGuardPortalPoint() {
    if (this._guardPortalPoint) return this._guardPortalPoint;
    const absX = Math.round(this.sceneW * 0.205) - this._worldOffsetX;
    const absY = Math.round(this.sceneH * 0.67) - this._worldOffsetY;
    this._guardPortalPoint = { x: absX, y: absY };
    return this._guardPortalPoint;
  }

  _getGuardSpawnPoint() {
    return this._getGuardPortalPoint();
  }

  _playGuardPortal(x, y) {
    return new Promise((resolve) => {
      if (!this.guardFxLayer || !this._guardPortalFrames.length || !this.app || this.app.destroyed) {
        resolve();
        return;
      }
      const anim = new PIXI.AnimatedSprite(this._guardPortalFrames);
      anim.anchor.set(0.5, 1);
      anim.x = x;
      anim.y = y;
      anim.scale.set(GUARD_PORTAL_SCALE);
      anim.zIndex = Math.round(y) + 1000;
      anim.loop = false;
      // Slightly slower portal for a clearer spawn/recall beat.
      anim.animationSpeed = 0.16;
      anim.onComplete = () => {
        setTimeout(() => {
          if (anim.parent) anim.parent.removeChild(anim);
          anim.destroy();
          resolve();
        }, 180);
      };
      this.guardFxLayer.addChild(anim);
      anim.play();
    });
  }

  _playAgentPortal(x, y, { onMidpoint } = {}) {
    return new Promise((resolve) => {
      if (!this.guardFxLayer || !this._agentPortalFrames.length || !this.app || this.app.destroyed) {
        onMidpoint?.();
        resolve();
        return;
      }
      const forwardFrames = [...this._agentPortalFrames];
      const reverseFrames = [...forwardFrames].reverse();
      const allFrames = [...forwardFrames, ...reverseFrames];
      const midFrame = forwardFrames.length;
      let midFired = false;

      const anim = new PIXI.AnimatedSprite(allFrames);
      anim.anchor.set(0.5, 1);
      anim.x = x;
      anim.y = y;
      anim.scale.set(AGENT_PORTAL_SCALE);
      anim.zIndex = Math.round(y) + 1000;
      anim.loop = false;
      anim.animationSpeed = AGENT_PORTAL_SPEED;
      anim.onFrameChange = (frame) => {
        if (!midFired && frame >= midFrame) {
          midFired = true;
          onMidpoint?.();
        }
      };
      anim.onComplete = () => {
        if (!midFired) { midFired = true; onMidpoint?.(); }
        setTimeout(() => {
          if (anim.parent) anim.parent.removeChild(anim);
          anim.destroy();
          resolve();
        }, 120);
      };
      this.guardFxLayer.addChild(anim);
      anim.play();
    });
  }

  deleteAgentById(agentId) {
    const npc = this.npcs.find((n) => n?.agent?.id === agentId);
    if (!npc?.container || npc.container.destroyed) return;
    const px = npc.container.x;
    const py = npc.container.y;
    this._playAgentPortal(px, py, {
      onMidpoint: () => {
        if (npc.container && !npc.container.destroyed) {
          npc.container.visible = false;
        }
      },
    });
  }

  _createGuardUnit(x, y) {
    const container = new PIXI.Container();
    container.x = x;
    container.y = y;

    const shadow = new PIXI.Graphics();
    shadow.beginFill(0x000000, 0.14);
    shadow.drawEllipse(0, -1, 10 * GUARD_SHADOW_SCALE, 3.3 * GUARD_SHADOW_SCALE);
    shadow.endFill();
    container.addChild(shadow);

    const spriteFrames = this._guardWalkFrames.length ? this._guardWalkFrames : this._guardIdleFrames;
    const body = new PIXI.AnimatedSprite(spriteFrames.length ? spriteFrames : [PIXI.Texture.WHITE]);
    body.anchor.set(0.5, 1);
    body.scale.set(GUARD_BODY_SCALE);
    body.animationSpeed = GUARD_WALK_ANIM_SPEED;
    if (spriteFrames.length) {
      body.play();
    } else {
      body.width = 14 * GUARD_BODY_SCALE;
      body.height = 14 * GUARD_BODY_SCALE;
      body.tint = 0x9ac9ff;
      body.alpha = 0.9;
      body.y = 4;
    }
    container.addChild(body);

    if (this.guardLayer) this.guardLayer.addChild(container);

    return {
      container,
      body,
      role: 'patrol',
      speed: GUARD_BASE_SPEED_MIN + Math.random() * GUARD_BASE_SPEED_VARIANCE,
      targetNpc: null,
      patrolTarget: null,
      returnTarget: null,
      arrivedForRecall: false,
      offsetX: -GUARD_ESCORT_JITTER_X + Math.random() * (GUARD_ESCORT_JITTER_X * 2),
      offsetY: -GUARD_ESCORT_JITTER_Y + Math.random() * (GUARD_ESCORT_JITTER_Y * 2),
    };
  }

  _getPendingNpcTargets() {
    return this.npcs
      .filter((n) => n?.agent && this._isPendingApproval(n.agent))
      .map((n) => ({ container: n.container, npcId: n.agent.id }));
  }

  _deployGuards(token) {
    if (!this.app || !this.guardLayer) return;
    this._clearGuardsImmediate();
    this._guardRecalling = false;
    this._guardPortalPlaying = false;
    const spawn = this._getGuardSpawnPoint();
    const pendingTargets = this._getPendingNpcTargets();
    const guardCount = 2 + pendingTargets.length;

    this._guardPendingSnapshot.clear();
    for (const t of pendingTargets) this._guardPendingSnapshot.add(t.npcId);

    const units = [];
    for (let i = 0; i < guardCount; i++) {
      const unit = this._createGuardUnit(spawn.x + (Math.random() * 8 - 4), spawn.y + (Math.random() * 4 - 2));
      unit.container.visible = false;
      if (i < pendingTargets.length) {
        unit.role = 'escort';
        unit.targetNpc = pendingTargets[i];
      } else {
        unit.role = 'patrol';
      }
      units.push(unit);
      this.guardUnits.push(unit);
    }

    this._guardPortalPlaying = true;
    this._playGuardPortal(spawn.x, spawn.y).then(() => {
      this._guardPortalPlaying = false;
      for (const unit of units) {
        if (!this.guardEnabled || token !== this._guardToken) {
          if (unit.container.parent) unit.container.parent.removeChild(unit.container);
          unit.container.destroy({ children: true });
          continue;
        }
        unit.container.visible = true;
      }
      if (!this.guardEnabled || token !== this._guardToken) {
        this.guardUnits = this.guardUnits.filter((u) => !units.includes(u));
      }
    });
  }

  _startRecallGuards() {
    if (!this.guardUnits.length) return;
    this._guardRecalling = true;
    const gate = this._getGuardPortalPoint();
    for (let i = 0; i < this.guardUnits.length; i++) {
      const unit = this.guardUnits[i];
      if (!unit?.container?.parent) continue;
      unit.role = 'returning';
      const slot = i % 5;
      const row = Math.floor(i / 5);
      unit.returnTarget = {
        x: gate.x + (slot - 2) * 16,
        y: gate.y - row * 12,
      };
      unit.patrolTarget = null;
      unit.targetNpc = null;
      unit.arrivedForRecall = false;
    }
  }

  _clearGuardsImmediate() {
    for (const unit of this.guardUnits) {
      if (unit?.container?.parent) unit.container.parent.removeChild(unit.container);
      unit?.container?.destroy({ children: true });
    }
    this.guardUnits = [];
  }

  _pickGuardPatrolTarget() {
    if (this.pathfinder) {
      const tile = this.pathfinder.getRandomWalkable();
      if (tile) return this.pathfinder.tileToPixel(tile.x, tile.y);
    }
    return {
      x: Math.round(this.sceneW * (0.1 + Math.random() * 0.8)) - this._worldOffsetX,
      y: Math.round(this.sceneH * (0.18 + Math.random() * 0.65)) - this._worldOffsetY,
    };
  }

  _updateGuards(delta) {
    if (!this.guardEnabled && !this.guardUnits.length) return;

    if (this.guardEnabled) this._syncGuardRoster();

    const returning = [];
    for (const unit of this.guardUnits) {
      if (!unit?.container?.parent || !unit.container.visible) continue;

      if (unit.role === 'returning') {
        const tx = unit.returnTarget?.x ?? this._getGuardPortalPoint().x;
        const ty = unit.returnTarget?.y ?? this._getGuardPortalPoint().y;
        const dx = tx - unit.container.x;
        const dy = ty - unit.container.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 2.2) {
          unit.arrivedForRecall = true;
        } else {
          unit.arrivedForRecall = false;
          unit.body.animationSpeed = GUARD_RETURN_ANIM_SPEED;
          const step = Math.min((unit.speed * GUARD_RETURN_SPEED_MULTIPLIER + 0.22) * delta, dist);
          unit.container.x += (dx / dist) * step;
          unit.container.y += (dy / dist) * step;
          unit.body.rotation = Math.atan2(dy, dx) * 0.12;
          if (this._guardWalkFrames.length && unit.body.textures !== this._guardWalkFrames) {
            unit.body.textures = this._guardWalkFrames;
            unit.body.play();
          }
          unit.container.zIndex = Math.round(unit.container.y) + 1;
        }
        if (unit.arrivedForRecall) returning.push(unit);
        continue;
      }

      if (!this.guardEnabled) continue;

      if (unit.role === 'escort' && !unit.targetNpc?.container?.parent) {
        unit.role = 'patrol';
        unit.targetNpc = null;
      }

      let tx = unit.container.x;
      let ty = unit.container.y;
      if (unit.role === 'escort' && unit.targetNpc?.container) {
        const escortSide = unit.targetNpc.container.x < this.sceneW * 0.5 ? 1 : -1;
        tx = unit.targetNpc.container.x + escortSide * GUARD_ESCORT_SIDE_OFFSET + unit.offsetX;
        ty = unit.targetNpc.container.y + unit.offsetY;
      } else {
        if (!unit.patrolTarget) unit.patrolTarget = this._pickGuardPatrolTarget();
        tx = unit.patrolTarget.x;
        ty = unit.patrolTarget.y;
      }

      const dx = tx - unit.container.x;
      const dy = ty - unit.container.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2) {
        unit.body.textures = this._guardIdleFrames.length ? this._guardIdleFrames : unit.body.textures;
        if (this._guardIdleFrames.length) unit.body.play();
        if (unit.role === 'patrol') unit.patrolTarget = this._pickGuardPatrolTarget();
      } else {
        if (this._guardWalkFrames.length && unit.body.textures !== this._guardWalkFrames) {
          unit.body.textures = this._guardWalkFrames;
          unit.body.play();
        }
        const isEscortingPending = unit.role === 'escort' && unit.targetNpc?.container;
        unit.body.animationSpeed = isEscortingPending ? GUARD_ESCORT_ANIM_SPEED : GUARD_WALK_ANIM_SPEED;
        const moveSpeed = isEscortingPending
          ? unit.speed * GUARD_ESCORT_SPEED_MULTIPLIER + 0.42
          : unit.speed;
        const step = Math.min(moveSpeed * delta, dist);
        unit.container.x += (dx / dist) * step;
        unit.container.y += (dy / dist) * step;
      }

      if (dist > 0.01) unit.body.rotation = Math.atan2(dy, dx) * 0.12;
      unit.container.zIndex = Math.round(unit.container.y) + 1;
    }

    // Despawn individual returning guards that arrived at the portal (with animation)
    if (returning.length && !this._guardPortalPlaying && !this._guardRecalling) {
      const gate = this._getGuardPortalPoint();
      this._guardPortalPlaying = true;
      for (const unit of returning) unit.container.visible = false;
      this._playGuardPortal(gate.x, gate.y).finally(() => {
        for (const unit of returning) {
          if (unit.container.parent) unit.container.parent.removeChild(unit.container);
          unit.container.destroy({ children: true });
        }
        this.guardUnits = this.guardUnits.filter((u) => !returning.includes(u));
        this._guardPortalPlaying = false;
      });
    }

    // Full recall (guard disabled): wait for all to arrive then portal out
    if (this._guardRecalling && !this._guardPortalPlaying && this.guardUnits.length > 0) {
      const allHome = this.guardUnits.every((u) => u.arrivedForRecall || !u.container?.visible);
      if (allHome) {
        this._guardPortalPlaying = true;
        const gate = this._getGuardPortalPoint();
        this._playGuardPortal(gate.x, gate.y).finally(() => {
          for (const unit of this.guardUnits) {
            if (unit.container.parent) unit.container.parent.removeChild(unit.container);
            unit.container.destroy({ children: true });
          }
          this.guardUnits = [];
          this._guardRecalling = false;
          this._guardPortalPlaying = false;
        });
      }
    }
  }

  _syncGuardRoster() {
    if (this._guardPortalPlaying) return;
    const pendingTargets = this._getPendingNpcTargets();
    const currentPendingIds = new Set(pendingTargets.map((t) => t.npcId));

    const escortedIds = new Set();
    for (const unit of this.guardUnits) {
      if (unit.role !== 'escort' || !unit.targetNpc?.npcId) continue;
      const targetId = unit.targetNpc.npcId;
      if (!currentPendingIds.has(targetId)) {
        // This NPC is no longer pending — send guard back immediately
        unit.role = 'returning';
        const gate = this._getGuardPortalPoint();
        unit.returnTarget = { x: gate.x + (Math.random() * 16 - 8), y: gate.y };
        unit.targetNpc = null;
      } else if (escortedIds.has(targetId)) {
        // Keep only one escort per pending NPC; extras fall back to patrol.
        unit.role = 'patrol';
        unit.targetNpc = null;
        unit.patrolTarget = null;
      } else {
        escortedIds.add(targetId);
      }
    }

    // Find pending NPCs that don't have an escort yet
    const unescorted = pendingTargets.filter((t) => !escortedIds.has(t.npcId));

    // Assign nearest patrol guard to each unescorted pending NPC
    for (const target of unescorted) {
      const patrols = this.guardUnits.filter((u) => u.role === 'patrol' && u.container?.visible);
      if (patrols.length > 0) {
        let nearest = patrols[0];
        let bestDist = Infinity;
        for (const p of patrols) {
          const dx = p.container.x - target.container.x;
          const dy = p.container.y - target.container.y;
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; nearest = p; }
        }
        nearest.role = 'escort';
        nearest.targetNpc = target;
        nearest.patrolTarget = null;
        escortedIds.add(target.npcId);
      }
    }

    const remainingUnescorted = pendingTargets.filter((target) => !escortedIds.has(target.npcId));

    // Ensure we have at least 2 patrol guards + 1 per pending
    const activeUnits = this.guardUnits.filter((u) => u.role !== 'returning');
    const patrolCount = activeUnits.filter((u) => u.role === 'patrol').length;
    const escortCount = activeUnits.filter((u) => u.role === 'escort').length;
    const desiredTotal = 2 + currentPendingIds.size;
    const deficit = desiredTotal - (patrolCount + escortCount);

    if (deficit > 0) {
      this._spawnExtraGuards(deficit, remainingUnescorted);
    }

    this._guardPendingSnapshot = currentPendingIds;
  }

  _spawnExtraGuards(count, unescortedTargets) {
    if (!this.app || !this.guardLayer || this._guardPortalPlaying) return;
    const spawn = this._getGuardSpawnPoint();
    const token = this._guardToken;
    const units = [];
    for (let i = 0; i < count; i++) {
      const unit = this._createGuardUnit(spawn.x + (Math.random() * 8 - 4), spawn.y + (Math.random() * 4 - 2));
      unit.container.visible = false;
      if (i < unescortedTargets.length) {
        unit.role = 'escort';
        unit.targetNpc = unescortedTargets[i];
      } else {
        unit.role = 'patrol';
      }
      units.push(unit);
      this.guardUnits.push(unit);
    }
    this._guardPortalPlaying = true;
    this._playGuardPortal(spawn.x, spawn.y).then(() => {
      this._guardPortalPlaying = false;
      for (const unit of units) {
        if (!this.guardEnabled || token !== this._guardToken) {
          if (unit.container.parent) unit.container.parent.removeChild(unit.container);
          unit.container.destroy({ children: true });
          continue;
        }
        unit.container.visible = true;
      }
      if (!this.guardEnabled || token !== this._guardToken) {
        this.guardUnits = this.guardUnits.filter((u) => !units.includes(u));
      }
    });
  }

  // ─── Data Helpers ─────────────────────────────────────────────

  _indexEvents(events) {
    this._eventsByAgent = new Map();
    this._waitingAgents = new Set();
    for (const evt of events || []) {
      const agentId = evt.agent_id;
      if (!agentId) continue;
      if (!this._eventsByAgent.has(agentId)) this._eventsByAgent.set(agentId, []);
      this._eventsByAgent.get(agentId).push(evt);
      if (this._isPendingStatus(evt.status)) this._waitingAgents.add(agentId);
    }
    for (const list of this._eventsByAgent.values()) {
      list.sort((a, b) => this._getEventTimeMs(a) - this._getEventTimeMs(b));
    }
  }

  _getEventTimeMs(event) {
    const timeValue = event?.start_time || event?.created_at || event?.updated_at || event?.end_time;
    const timeMs = timeValue ? new Date(timeValue).getTime() : NaN;
    return Number.isFinite(timeMs) ? timeMs : 0;
  }

  _getAgentState(agent) {
    if (!agent) return 'offline';
    if (agent.status === 'working' || agent.status === 'running' || agent.status === 'idle') return 'working';
    if (this._isPendingStatus(agent.status)) return 'pending';
    return 'offline';
  }

  _getSnippet(agent) {
    const ae = this._eventsByAgent.get(agent.id) || [];
    if (!ae.length) return '';
    const convos = ae[ae.length - 1].conversations || [];
    for (let i = convos.length - 1; i >= 0; i--) {
      if (convos[i].role === 'assistant' && convos[i].text)
        return convos[i].text.substring(0, 200);
    }
    return '';
  }

  _getLatestEvent(agent) {
    const ae = this._eventsByAgent.get(agent.id) || [];
    return ae.length ? ae[ae.length - 1] : null;
  }

  /** Update agent/event data (for periodic refresh). */
  updateData(agents, events) {
    this._agents = agents;
    this._events = events;
    this._agentsById = new Map((agents || []).map((a) => [a.id, a]));
    this._indexEvents(events);
    if (this._shouldRebuildScene(agents)) {
      this._incrementalUpdateScene(agents);
      this._syncShowNpcSpriteFromScene();
    } else {
      this._refreshNpcDataInPlace(agents, events);
    }
  }

  /** Clean up PixiJS resources. */
  destroy() {
    this._cancelFieldNpcDialogue();
    this._destroyFieldNpcDialogueLayer();
    this._clearCursorStateTimer();
    this._setCursorState('normal');
    if (this._windowPointerMove) window.removeEventListener('pointermove', this._windowPointerMove);
    if (this._windowPointerUp) {
      window.removeEventListener('pointerup', this._windowPointerUp);
      window.removeEventListener('pointercancel', this._windowPointerUp);
      window.removeEventListener('blur', this._windowPointerUp);
    }
    this._dragContext = null;
    this._clearGuardsImmediate();
    this._destroyFloorScreenOverlay();
    this._destroyWallDashboardOverlay();
    this._destroyShowEasterEggOverlay();
    this._destroyCreatorEasterEggOverlay();
    if (this._mapOverlayContainer) {
      if (this._mapOverlayContainer.parent) this._mapOverlayContainer.parent.removeChild(this._mapOverlayContainer);
      this._mapOverlayContainer.destroy({ children: true });
      this._mapOverlayContainer = null;
    }
    this._resizeObs?.disconnect();
    this.app?.destroy(true, { children: true, texture: false, baseTexture: false });
    this.app = null;
  }
}
