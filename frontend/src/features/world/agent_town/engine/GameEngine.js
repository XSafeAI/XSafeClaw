import * as PIXI from 'pixi.js';
import PathFinder from './PathFinder';
import TiledRenderer from './TiledRenderer';
import SpriteLoader from './SpriteLoader';
import {
  FW, FH, NPC_SCALE, CHAR_NAMES, BG_COLOR,
  MAP_MODE, TILED_MAP_URL, TILED_BASE_PATH, DEFAULT_MAP_CONFIG,
  SCENE_IMAGE_URL, SCENE_W, SCENE_H,
  WALK_ZONES, MEETING_DIST, MEETING_TIME, MEETING_COOLDOWN, BUBBLE_MAX_CHARS,
} from '../config/constants';

const GUARD_PORTAL_URL = '/portals/3.png';
const GUARD_IDLE_URL = '/guard/Idle.png';
const GUARD_WALK_URL = '/guard/Walk.png';
const GUARD_ATTACK_URL = '/guard/Attack.png';
const ISSUE_QUESTION_URL = '/UI/png/status/status_question.png';
const GUARD_PORTAL_SCALE = 4.2;
const GUARD_BODY_SCALE = 3.6;
const GUARD_SHADOW_SCALE = 3.3;
const ISSUE_MARKER_SCALE = Math.max(2.8, NPC_SCALE * 0.92);

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
    this.pendingNpc   = null;
    this.sceneW       = SCENE_W;
    this.sceneH       = SCENE_H;
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
    this._issueQuestionTexture = null;
    this._guardUnsafeIds = new Set();
    this._guardChecking = false;
    this.mapConfig = {
      ...DEFAULT_MAP_CONFIG,
      ...(options.mapConfig || {}),
    };

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
    this.onLayoutChange?.({ sceneW: this.sceneW, sceneH: this.sceneH });
  }

  /** Load sprites + map. onProgress(0-1, label). */
  async loadAssets(onProgress) {
    // 1. Load sprite sheets
    onProgress?.(0, 'Loading sprites...');
    await this.spriteLoader.load((p) => onProgress?.(p * 0.5, 'Loading sprites...'));

    // 2. Wait for pixel font
    try { await document.fonts.load('8px "Press Start 2P"'); } catch (_) {}

    // 3. Load map
    onProgress?.(0.5, 'Loading map...');
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

        const contentBounds = this.tiledRenderer.getContentBounds();

        this.sceneW = contentBounds.pixelW;
        this.sceneH = contentBounds.pixelH;
        this._worldOffsetX = -contentBounds.pixelX;
        this._worldOffsetY = -contentBounds.pixelY;

        const mapContainer = this.tiledRenderer.render();
        this.world.addChild(mapContainer);

        // Keep pathfinding bounded, but render the full map the artist exported.
        const { grid } = this.tiledRenderer.buildBoundedGrid(this.mapConfig?.collisionLayer);
        this.pathfinder = new PathFinder(grid, this.tiledRenderer.tileW, this.tiledRenderer.tileH);

        mapContainer.x = this._worldOffsetX;
        mapContainer.y = this._worldOffsetY;
        this.npcLayer.x = this._worldOffsetX;
        this.npcLayer.y = this._worldOffsetY;
        this.guardLayer.x = this._worldOffsetX;
        this.guardLayer.y = this._worldOffsetY;
        this.guardFxLayer.x = this._worldOffsetX;
        this.guardFxLayer.y = this._worldOffsetY;

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
    await this._loadGuardAssets();
    this._resize();
    onProgress?.(1, 'Ready');
  }

  async _loadGuardAssets() {
    try {
      const [portalTex, idleTex, walkTex, attackTex, issueQuestionTex] = await Promise.all([
        PIXI.Assets.load(GUARD_PORTAL_URL),
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
      this._guardIdleFrames = toFrames(idleTex);
      this._guardWalkFrames = toFrames(walkTex);
      this._guardAttackFrames = toFrames(attackTex);
      issueQuestionTex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
      this._issueQuestionTexture = issueQuestionTex;
    } catch (_) {
      this._guardPortalFrames = [];
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
    const curTile = this.pathfinder.pixelToTile(npc.container.x, npc.container.y);
    if (!this.pathfinder.isWalkable(curTile.x, curTile.y)) {
      const near = this.pathfinder.getRandomWalkable();
      if (near) {
        const np = this.pathfinder.tileToPixel(near.x, near.y);
        npc.container.x = np.x;
        npc.container.y = np.y;
      }
      npc.idleTimer = 0.25;
      return false;
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

    if (npc._pendingFrozen || npc._guardFrozen) {
      npc.aiState = 'frozen';
      npc.sprite.textures = npc.frames.idle;
      npc.sprite.play();
      return;
    }

    if (npc.mode === 'pathfind') {
      npc.aiState = 'idle';
      npc.idleTimer = afterMeeting ? (0.08 + Math.random() * 0.15) : (0.3 + Math.random() * 0.5);
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
    if (a._dragActive || b._dragActive || a._guardFrozen || b._guardFrozen || a._pendingFrozen || b._pendingFrozen) {
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

  _renderNpcScene(agents = []) {
    const activeAgents = (agents || []).filter((agent) => (
      this._isRunningStatus(agent?.status)
    ));
    const maxSceneAgents = this.pathfinder
      ? Math.min(activeAgents.length, Math.max(CHAR_NAMES.length, 1))
      : Math.min(activeAgents.length, WALK_ZONES.length);
    const sceneAgents = activeAgents.slice(0, maxSceneAgents);

    for (let i = 0; i < sceneAgents.length; i++) {
      const npc = this._createNPC(sceneAgents[i], i);
      if (!npc) continue;
      this.npcs.push(npc);
    }

    this.pendingNpc = (agents || []).some((agent) => this._isPendingStatus(agent?.status))
      ? this._createPendingNPC()
      : null;
  }

  _clearNpcScene() {
    for (const npc of this.npcs) {
      this._removeBubble?.(npc);
      npc?.container?.destroy({ children: true });
    }
    this.npcs = [];

    if (this.pendingNpc?.container) {
      this.pendingNpc.container.destroy({ children: true });
    }
    this.pendingNpc = null;
  }

  // ─── NPC Creation ─────────────────────────────────────────────

  _createGoldOutlineSprites(sprite, container, offsetPx = 4, addAtIndex = null, alpha = 1) {
    const goldFilter = new PIXI.ColorMatrixFilter();
    goldFilter.matrix = [
      0, 0, 0, 0, 232 / 255,
      0, 0, 0, 0, 200 / 255,
      0, 0, 0, 0, 96 / 255,
      0, 0, 0, 1, 0,
    ];

    const out = [];
    const d = offsetPx;
    const offsets = [[-d, 0], [d, 0], [0, -d], [0, d], [-d, -d], [d, -d], [-d, d], [d, d]];

    for (const [ox, oy] of offsets) {
      const clone = new PIXI.Sprite(sprite.texture);
      clone.anchor.set(0.5, 1);
      clone.scale.set(sprite.scale.x, sprite.scale.y);
      clone.filters = [goldFilter];
      clone.alpha = alpha;
      clone.x = ox;
      clone.y = oy;
      if (typeof addAtIndex === 'number') {
        container.addChildAt(clone, addAtIndex);
      } else {
        container.addChild(clone);
      }
      out.push(clone);
    }
    return out;
  }

  _createIssueMarkerSprite() {
    if (this._issueQuestionTexture) {
      const marker = new PIXI.Sprite(this._issueQuestionTexture);
      marker.anchor.set(0.5, 1);
      marker.scale.set(ISSUE_MARKER_SCALE);
      marker.x = 0;
      marker.y = -FH * NPC_SCALE - 2;
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
      npc.aiState = (npc._pendingFrozen || npc._guardFrozen) ? 'frozen' : 'idle';
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
      if (npc._pendingFrozen || npc._guardFrozen) {
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
  }

  _clearIssueVisuals(npc) {
    if (!npc) return;
    if (npc.goldOutlines) {
      for (const os of npc.goldOutlines) {
        if (os.parent) os.parent.removeChild(os);
        os.destroy();
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
    npc.hasIssue = shouldFreeze || npc._guardFrozen;

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

    if (!npc._guardFrozen) {
      this._clearIssueVisuals(npc);
      npc.hasIssue = false;
    }

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

  _createNPC(agent, idx) {
    const charName = CHAR_NAMES[idx % CHAR_NAMES.length];
    const frames   = this.spriteLoader.charFrames[charName];
    if (!frames || !frames.front.length) return null;
    const isRunner = this._isRunningStatus(agent?.status);

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
    const state    = this._getAgentState(agent);
    const dotColor = state === 'working' ? 0x22c55e : state === 'idle' ? 0x6d63ff : 0xbbb5a8;
    const nameTag  = new PIXI.Text(agent.name.replace(/^Agent-/, '').substring(0, 10), {
      fontFamily: 'Press Start 2P', fontSize: 4, fill: dotColor, align: 'center',
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
        _originalHasIssue: hasIssue, _guardFrozen: false, _pendingFrozen: hasPendingApproval,
        mode: isRunner ? 'pathfind' : 'stationary',
        behavior: isRunner ? 'running' : 'idle',
        speed: 0.45 + Math.random() * 0.25,
        aiState: hasPendingApproval ? 'frozen' : (isRunner ? 'idle' : 'stationary'), _curDir: 'idle',
        idleTimer: isRunner ? (0.08 + Math.random() * 0.15) : 0,
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
        _originalHasIssue: hasIssue, _guardFrozen: false, _pendingFrozen: hasPendingApproval,
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

    this._attachNpcDragHandlers(npcObj, () => {
      const pendingNow = this._isPendingApproval(agent);
      if (pendingNow) {
        this.onPendingClick?.();
        return;
      }
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
      _guardFrozen: false,
      meetingTimer: 0,
      meetingPartner: null,
    };
    this._attachNpcDragHandlers(pendingNpc, () => this.onPendingClick?.());
    return pendingNpc;
  }

  // ─── Speech Bubbles ──────────────────────────────────────────

  _createBubble(npc, text) {
    if (npc.bubble) this._removeBubble(npc);

    const bc = new PIXI.Container();
    const truncated = text.length > BUBBLE_MAX_CHARS ? text.substring(0, BUBBLE_MAX_CHARS) + '…' : text;
    const bt = new PIXI.Text(truncated, {
      fontFamily: 'Press Start 2P', fontSize: 15, fill: 0x3a3020,
      wordWrap: true, wordWrapWidth: 360, lineHeight: 22,
      align: 'center',
    });
    bt.anchor.set(0.5, 1);

    const pad = 22;
    const bg = new PIXI.Graphics();
    bg.beginFill(0xFFFDF8, 0.94);
    bg.lineStyle(1, 0xB2773F, 0.6);
    const bw = Math.max(320, bt.width + pad * 2);
    const bh = Math.max(120, bt.height + pad * 2);
    bg.drawRoundedRect(-bw / 2, -bh, bw, bh, 10);
    bg.endFill();
    // Small triangle pointer at bottom
    bg.beginFill(0xFFFDF8, 0.94);
    bg.moveTo(-12, 0); bg.lineTo(0, 15); bg.lineTo(12, 0);
    bg.endFill();

    bt.y = -pad;
    bc.addChild(bg); bc.addChild(bt);
    bc.y = -FH * NPC_SCALE - 36;
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

        // Bubble fade
        if (npc.bubble && npc._bubbleFadeIn) {
          npc.bubble.alpha = Math.min(1, npc.bubble.alpha + 0.05);
          if (npc.bubble.alpha >= 1) npc._bubbleFadeIn = false;
        }

        if (npc.aiState === 'meeting') {
          this._updateMeeting(npc, delta);
        } else if (npc._dragActive || npc._guardFrozen || npc._pendingFrozen) {
          // Frozen by guard — stay in place
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

        if (npc.emoteSprite) {
          const bob = Math.sin(Date.now() / 240) * 5;
          const pulse = Math.sin(Date.now() / 220) * 0.08 + 0.98;
          npc.emoteSprite.y = -FH * NPC_SCALE - 2 + bob;
          npc.emoteSprite.scale.set(ISSUE_MARKER_SCALE * pulse);
          npc.emoteSprite.alpha = Math.sin(Date.now() / 260) * 0.08 + 0.94;
        }
      }

      // Pending NPC: keep a gentle glow + marker pulse
      if (this.pendingNpc) {
        this.pendingNpc.container.alpha = Math.sin(Date.now() / 500) * 0.12 + 0.88;
        if (this.pendingNpc.emoteSprite) {
          const bob = Math.sin(Date.now() / 240) * 5;
          const pulse = Math.sin(Date.now() / 220) * 0.08 + 0.98;
          this.pendingNpc.emoteSprite.y = -FH * NPC_SCALE - 2 + bob;
          this.pendingNpc.emoteSprite.scale.set(ISSUE_MARKER_SCALE * pulse);
          this.pendingNpc.emoteSprite.alpha = Math.sin(Date.now() / 260) * 0.08 + 0.94;
        }
      }

      // Guard units
      this._updateGuards(delta);
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
          npc.idleTimer = 0.06 + Math.random() * 0.12;
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
          npc._stuckFrames = 0;  // made progress → reset
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

        // If stuck for >5 seconds (~300 frames), find a new path
        if (npc._stuckFrames > 300) {
          npc.path = null;
          npc.aiState = 'idle';
          npc.idleTimer = 0.12 + Math.random() * 0.2;
          npc._stuckFrames = 0;
          npc._failedPaths++;
          this._setWorkingPauseSprite(npc, true);
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
          npc.aiState = 'idle'; npc.idleTimer = 0.12 + Math.random() * 0.3;
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
      this._deployGuards(token);
      this._checkGuardApi(token);
    } else {
      this._unfreezeAllNpcs();
      this._startRecallGuards();
    }
  }

  async _checkGuardApi(token) {
    if (this._guardChecking) return;
    this._guardChecking = true;
    try {
      const agentIds = (this._agents || []).map((a) => a.id).filter(Boolean);
      const checks = agentIds.map((sid) =>
        fetch(`/api/guard/check/${sid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'base' }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (!data || !Array.isArray(data) || !data.length) return null;
            return { session_id: sid, verdict: data[0].verdict };
          })
          .catch(() => null)
      );
      const results = await Promise.all(checks);
      if (token !== this._guardToken || !this.guardEnabled) return;
      this._applyGuardResults(results.filter(Boolean));
    } catch (err) {
      console.warn('[Guard] API check failed:', err);
    } finally {
      this._guardChecking = false;
    }
  }

  _applyGuardResults(results) {
    this._guardUnsafeIds.clear();
    for (const r of results) {
      if (r.verdict === 'unsafe') {
        this._guardUnsafeIds.add(r.session_id);
      }
    }

    for (const npc of this.npcs) {
      if (!npc?.agent) continue;
      if (this._guardUnsafeIds.has(npc.agent.id)) {
        this._freezeNpc(npc);
      }
    }

    this._reassignGuards();
  }

  _freezeNpc(npc) {
    npc._guardFrozen = true;
    if (npc.mode === 'pathfind') {
      npc.aiState = 'frozen';
      npc.path = null;
    }
    npc.sprite.textures = npc.frames.idle;
    npc.sprite.play();

    npc.hasIssue = true;
    this._ensureIssueVisuals(npc);
  }

  _unfreezeNpc(npc) {
    if (!npc._guardFrozen) return;
    npc._guardFrozen = false;

    if (npc.mode === 'pathfind') {
      npc.aiState = 'idle';
      npc.idleTimer = 1 + Math.random() * 2;
    }

    if (npc._pendingFrozen || this._isPendingApproval(npc.agent)) {
      this._setPendingNpcState(npc, true);
      return;
    }
    this._clearIssueVisuals(npc);
    npc.hasIssue = false;
  }

  _unfreezeAllNpcs() {
    this._guardUnsafeIds.clear();
    for (const npc of this.npcs) {
      if (npc) this._unfreezeNpc(npc);
    }
  }

  _reassignGuards() {
    const issueTargets = this._getIssueTargets();
    const escorted = new Set();
    for (const unit of this.guardUnits) {
      if (unit.role === 'escort' && unit.targetNpc?.container?.parent) {
        escorted.add(unit.targetNpc.container);
      }
    }
    const free = issueTargets.filter((t) => !escorted.has(t.container));
    let fi = 0;
    for (const unit of this.guardUnits) {
      if (fi >= free.length) break;
      if (unit.role === 'patrol') {
        unit.role = 'escort';
        unit.targetNpc = free[fi++];
        unit.patrolTarget = null;
      }
    }
  }

  _getGuardPortalPoint() {
    if (this._guardPortalPoint) return this._guardPortalPoint;
    this._guardPortalPoint = {
      // Left-middle office area in town map
      x: Math.round(this.sceneW * 0.205),
      y: Math.round(this.sceneH * 0.67),
    };
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
    body.animationSpeed = 0.16;
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
      speed: 0.55 + Math.random() * 0.22,
      targetNpc: null,
      patrolTarget: null,
      returnTarget: null,
      arrivedForRecall: false,
      offsetX: -20 + Math.random() * 40,
      offsetY: -5 + Math.random() * 10,
    };
  }

  _getIssueTargets() {
    const issueNpcs = this.npcs.filter((n) => n && this._isIssueAgent(n.agent));
    const targets = issueNpcs.map((n) => ({ container: n.container }));
    if (this.pendingNpc?.container) targets.push({ container: this.pendingNpc.container });
    return targets;
  }

  _isIssueAgent(agent) {
    if (!agent) return false;
    if (this._guardUnsafeIds.has(agent.id)) return true;
    const latest = this._agentsById.get(agent.id) || agent;
    return this._isPendingStatus(latest.status) || latest.status === 'error' || this._waitingAgents.has(agent.id);
  }

  _deployGuards(token) {
    if (!this.app || !this.guardLayer) return;
    this._clearGuardsImmediate();
    this._guardRecalling = false;
    this._guardPortalPlaying = false;
    const spawn = this._getGuardSpawnPoint();
    const issueTargets = this._getIssueTargets();
    const guardCount = Math.max(2, issueTargets.length + 2);

    const units = [];
    for (let i = 0; i < guardCount; i++) {
      const unit = this._createGuardUnit(spawn.x + (Math.random() * 8 - 4), spawn.y + (Math.random() * 4 - 2));
      unit.container.visible = false;
      if (i < issueTargets.length) {
        unit.role = 'escort';
        unit.targetNpc = issueTargets[i];
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
      x: Math.round(this.sceneW * (0.1 + Math.random() * 0.8)),
      y: Math.round(this.sceneH * (0.18 + Math.random() * 0.65)),
    };
  }

  _updateGuards(delta) {
    if (!this.guardUnits.length) return;
    const issueTargets = this._getIssueTargets();
    let recallReadyCount = 0;

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
          unit.body.textures = this._guardIdleFrames.length ? this._guardIdleFrames : unit.body.textures;
          if (this._guardIdleFrames.length) unit.body.play();
        } else {
          unit.arrivedForRecall = false;
          const step = Math.min((unit.speed + 0.18) * delta, dist);
          unit.container.x += (dx / dist) * step;
          unit.container.y += (dy / dist) * step;
          unit.body.rotation = Math.atan2(dy, dx) * 0.12;
          if (this._guardWalkFrames.length && unit.body.textures !== this._guardWalkFrames) {
            unit.body.textures = this._guardWalkFrames;
            unit.body.play();
          }
          unit.container.zIndex = Math.round(unit.container.y) + 1;
        }
        if (unit.arrivedForRecall) recallReadyCount++;
        continue;
      }

      if (!this.guardEnabled) continue;

      if (unit.role === 'escort') {
        if (!unit.targetNpc?.container?.parent) {
          unit.targetNpc = issueTargets[0] || null;
          if (!unit.targetNpc) unit.role = 'patrol';
        }
      }

      let tx = unit.container.x;
      let ty = unit.container.y;
      if (unit.role === 'escort' && unit.targetNpc?.container) {
        tx = unit.targetNpc.container.x + unit.offsetX;
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
        const step = Math.min(unit.speed * delta, dist);
        unit.container.x += (dx / dist) * step;
        unit.container.y += (dy / dist) * step;
      }

      if (dist > 0.01) unit.body.rotation = Math.atan2(dy, dx) * 0.12;
      unit.container.zIndex = Math.round(unit.container.y) + 1;
    }

    if (this._guardRecalling && !this._guardPortalPlaying && this.guardUnits.length > 0 && recallReadyCount >= this.guardUnits.length) {
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
    this._meetingCooldowns.clear();
    this._clearNpcScene();
    this._renderNpcScene(agents);
    this._syncPendingNpcStates();
    if (this.guardEnabled) this._deployGuards(this._guardToken);
  }

  /** Clean up PixiJS resources. */
  destroy() {
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
    this._resizeObs?.disconnect();
    this.app?.destroy(true, { children: true, texture: false, baseTexture: false });
    this.app = null;
  }
}
