import * as PIXI from 'pixi.js';
import PathFinder from './PathFinder';
import TiledRenderer from './TiledRenderer';
import SpriteLoader from './SpriteLoader';
import {
  FW, FH, NPC_SCALE, CHAR_NAMES, BG_COLOR,
  MAP_MODE, TILED_MAP_URL, TILED_BASE_PATH,
  SCENE_IMAGE_URL, SCENE_W, SCENE_H,
  WALK_ZONES, MEETING_DIST, MEETING_TIME, BUBBLE_MAX_CHARS,
} from '../config/constants';

const GUARD_PORTAL_URL = '/portals/3.png';
const GUARD_IDLE_URL = '/guard/Idle.png';
const GUARD_WALK_URL = '/guard/Walk.png';
const GUARD_ATTACK_URL = '/guard/Attack.png';

/**
 * The core game engine — manages PixiJS app, map, NPCs, and game loop.
 * Framework-agnostic: React (or any UI) communicates via callbacks.
 */
export default class GameEngine {
  constructor() {
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
    this._guardUnsafeIds = new Set();
    this._guardChecking = false;

    // Callbacks set by React component
    this.onNpcHover   = null;  // (npcData, globalPos) => void
    this.onNpcLeave   = null;  // () => void
    this.onNpcClick   = null;  // (agentData) => void
    this.onPendingClick = null; // () => void
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
    if (MAP_MODE === 'tiled' && TILED_MAP_URL) {
      try {
        const mapRes  = await fetch(TILED_MAP_URL);
        const mapData = await mapRes.json();

        this.tiledRenderer = new TiledRenderer(mapData);
        await this.tiledRenderer.loadTilesets(TILED_BASE_PATH, TILED_MAP_URL);

        this.sceneW = this.tiledRenderer.pixelW;
        this.sceneH = this.tiledRenderer.pixelH;

        const mapContainer = this.tiledRenderer.render();
        this.world.addChild(mapContainer);

        // Build bounded collision grid
        const { grid, rTop, rBot } = this.tiledRenderer.buildBoundedGrid();
        this.pathfinder = new PathFinder(grid, this.tiledRenderer.tileW, this.tiledRenderer.tileH);

        // Crop scene to building bounds
        const marginTiles = 1;
        const cropBot = Math.min(this.tiledRenderer.mapH, rBot + 1 + marginTiles) * this.tiledRenderer.tileH;
        this.sceneW = this.tiledRenderer.pixelW;
        this.sceneH = cropBot;

        mapContainer.y = 0;
        this.npcLayer.y = 0;

        console.log(
          `Map loaded: ${this.tiledRenderer.mapW}×${this.tiledRenderer.mapH} tiles, ` +
          `walkable: ${this.pathfinder._walkable.length}, scene: ${this.sceneW}×${this.sceneH}`
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
      const [portalTex, idleTex, walkTex, attackTex] = await Promise.all([
        PIXI.Assets.load(GUARD_PORTAL_URL),
        PIXI.Assets.load(GUARD_IDLE_URL),
        PIXI.Assets.load(GUARD_WALK_URL),
        PIXI.Assets.load(GUARD_ATTACK_URL),
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
    } catch (_) {
      this._guardPortalFrames = [];
      this._guardIdleFrames = [];
      this._guardWalkFrames = [];
      this._guardAttackFrames = [];
    }
  }

  /** Populate NPCs from agent data. */
  populateNPCs(agents, events) {
    this._agents = agents;
    this._events = events;
    this._agentsById = new Map((agents || []).map((a) => [a.id, a]));
    this._indexEvents(events);

    const sceneAgents  = agents.slice(0, WALK_ZONES.length);

    for (let i = 0; i < sceneAgents.length; i++) {
      const npc = this._createNPC(sceneAgents[i], i);
      if (!npc) continue;
      this.npcs.push(npc);
    }

    // Pending NPC (Edward)
    this.pendingNpc = this._createPendingNPC();

    // Start game loop
    this._startLoop();
    if (this.guardEnabled) this._deployGuards(this._guardToken);
  }

  // ─── NPC Creation ─────────────────────────────────────────────

  _createGoldOutlineSprites(sprite, container, offsetPx = 2, addAtIndex = null) {
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
      clone.alpha = 0.9;
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

  _createNPC(agent, idx) {
    const charName = CHAR_NAMES[idx % CHAR_NAMES.length];
    const frames   = this.spriteLoader.charFrames[charName];
    if (!frames || !frames.front.length) return null;

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

    // Exclamation emote
    let emoteSprite = null;
    const hasIssue = agent.status === 'waiting' || agent.status === 'error' ||
                     this._waitingAgents.has(agent.id);
    if (hasIssue && this.spriteLoader.emoteFrames.length) {
      emoteSprite = new PIXI.AnimatedSprite(this.spriteLoader.emoteFrames);
      emoteSprite.animationSpeed = 0.15;
      emoteSprite.anchor.set(0.5, 1);
      emoteSprite.scale.set(1.0);
      emoteSprite.y = -FH * NPC_SCALE - 8;
      emoteSprite.x = 8;
      emoteSprite.play();
      container.addChild(emoteSprite);
    }

    // Interactive
    container.eventMode = 'static';
    container.cursor    = 'pointer';
    const hw = FW * NPC_SCALE, hh = FH * NPC_SCALE;
    container.hitArea = new PIXI.Rectangle(-hw / 2, -hh, hw, hh);

    // Gold outline on character: 8 solid-gold copies at 2px offsets (all around)
    let _goldOutlines = null;
    if (hasIssue) {
      // add after shadow and before main sprite
      _goldOutlines = this._createGoldOutlineSprites(sprite, container, 2, 1);
    }

    container.on('pointerover', () => {
      const gp = container.getGlobalPosition();
      const rect = this.app.view.getBoundingClientRect();
      this.onNpcHover?.({
        agent, charName, state,
        snippet: this._getSnippet(agent),
        event: this._getLatestEvent(agent),
        isPending: hasIssue,
      }, {
        x: rect.left + gp.x,
        y: Math.max(4, rect.top + gp.y - FH * NPC_SCALE * this.world.scale.x - 16),
      });
    });
    container.on('pointerout', () => this.onNpcLeave?.());
    container.on('pointertap', () => {
      this.onNpcClick?.({
        agent, charName, state,
        snippet: this._getSnippet(agent),
        event: this._getLatestEvent(agent),
        events: this._eventsByAgent.get(agent.id) || [],
        isPending: hasIssue,
      });
    });

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
        _originalHasIssue: hasIssue, _guardFrozen: false,
        mode: 'pathfind',
        speed: 0.3 + Math.random() * 0.2,
        aiState: 'idle', _curDir: 'idle',
        idleTimer: 2 + Math.random() * 3,
        path: null, pathIdx: 0,
        homeTile: this.pathfinder.pixelToTile(startPx.x, startPx.y),
        _failedPaths: 0, _stuckFrames: 0,
        _lastX: startPx.x, _lastY: startPx.y,
        meetingTimer: 0, meetingPartner: null, bubble: null,
      };
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
        _originalHasIssue: hasIssue, _guardFrozen: false,
        mode: 'patrol',
        speed: 0.2 + Math.random() * 0.35,
        movingDown,
        zone, xBase: zone.x + xOffset,
      };
    }

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

    // Gold outline behind pending sprite
    const goldOutlines = this._createGoldOutlineSprites(sprite, container, 2);
    container.addChild(sprite);

    if (this.spriteLoader.emoteFrames.length) {
      const emote = new PIXI.AnimatedSprite(this.spriteLoader.emoteFrames);
      emote.animationSpeed = 0.15;
      emote.anchor.set(0.5, 1);
      emote.scale.set(1.0);
      emote.y = -FH * NPC_SCALE - 6;
      emote.play();
      container.addChild(emote);
    }

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
    container.cursor    = 'pointer';
    container.hitArea   = new PIXI.Rectangle(-20, -FH * NPC_SCALE, 40, FH * NPC_SCALE);
    container.on('pointertap', () => this.onPendingClick?.());

    // Hover shows tooltip too
    container.on('pointerover', () => {
      const gp = container.getGlobalPosition();
      const rect = this.app.view.getBoundingClientRect();
      this.onNpcHover?.({
        agent: { name: 'Agent-Edward', id: 'pending-edward', status: 'waiting',
                 provider: 'OpenAI', model: 'gpt-4', pid: '—' },
        charName, state: 'waiting',
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
    return { container, sprite, goldOutlines };
  }

  // ─── Speech Bubbles ──────────────────────────────────────────

  _createBubble(npc, text) {
    if (npc.bubble) this._removeBubble(npc);

    const bc = new PIXI.Container();
    const truncated = text.length > BUBBLE_MAX_CHARS ? text.substring(0, BUBBLE_MAX_CHARS) + '…' : text;
    const bt = new PIXI.Text(truncated, {
      fontFamily: 'Press Start 2P', fontSize: 3.5, fill: 0x3a3020,
      wordWrap: true, wordWrapWidth: 110, lineHeight: 7,
    });
    bt.anchor.set(0.5, 1);

    const pad = 7;
    const bg = new PIXI.Graphics();
    bg.beginFill(0xFFFDF8, 0.94);
    bg.lineStyle(1, 0xB2773F, 0.6);
    const bw = bt.width + pad * 2, bh = bt.height + pad * 2;
    bg.drawRoundedRect(-bw / 2, -bh, bw, bh, 4);
    bg.endFill();
    // Small triangle pointer at bottom
    bg.beginFill(0xFFFDF8, 0.94);
    bg.moveTo(-4, 0); bg.lineTo(0, 5); bg.lineTo(4, 0);
    bg.endFill();

    bt.y = -pad;
    bc.addChild(bg); bc.addChild(bt);
    bc.y = -FH * NPC_SCALE - 8;
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
      if (this.pathfinder) {
        for (let i = 0; i < this.npcs.length; i++) {
          const a = this.npcs[i];
          if (!a || a.aiState !== 'walking') continue;
          for (let j = i + 1; j < this.npcs.length; j++) {
            const b = this.npcs[j];
            if (!b || b.aiState !== 'walking') continue;
            const dx = a.container.x - b.container.x;
            const dy = a.container.y - b.container.y;
            if (Math.sqrt(dx * dx + dy * dy) < MEETING_DIST) {
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

        if (npc._guardFrozen) {
          // Frozen by guard — stay in place
        } else if (npc.mode === 'patrol') {
          this._updatePatrol(npc, delta);
        } else if (npc.mode === 'pathfind' && this.pathfinder) {
          this._updatePathfind(npc, delta);
        }

        npc.container.zIndex = Math.round(npc.container.y);

        // Sync gold outline textures with the main sprite's current frame
        if (npc.goldOutlines) {
          const curTex = npc.sprite.texture;
          const pulse = Math.sin(Date.now() / 400) * 0.15 + 0.8;
          for (const os of npc.goldOutlines) {
            os.texture = curTex;
            os.alpha = pulse;
          }
        }
      }

      // Pending NPC: sync gold outlines + gentle glow
      if (this.pendingNpc) {
        this.pendingNpc.container.alpha = Math.sin(Date.now() / 500) * 0.12 + 0.88;
        if (this.pendingNpc.goldOutlines) {
          const curTex = this.pendingNpc.sprite.texture;
          const pulse = Math.sin(Date.now() / 400) * 0.15 + 0.8;
          for (const os of this.pendingNpc.goldOutlines) {
            os.texture = curTex;
            os.alpha = pulse;
          }
        }
      }

      // Guard units
      this._updateGuards(delta);
    });
  }

  _startMeeting(a, b) {
    a.aiState = 'meeting'; b.aiState = 'meeting';
    a.meetingTimer = MEETING_TIME; b.meetingTimer = MEETING_TIME;
    a.meetingPartner = b; b.meetingPartner = a;

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
          const curTile = this.pathfinder.pixelToTile(npc.container.x, npc.container.y);
          if (!this.pathfinder.isWalkable(curTile.x, curTile.y)) {
            const near = this.pathfinder.getRandomWalkable();
            if (near) {
              const np = this.pathfinder.tileToPixel(near.x, near.y);
              npc.container.x = np.x; npc.container.y = np.y;
            }
            npc.idleTimer = 0.5;
            break;
          }

          const minDist = npc._failedPaths > 3 ? 2 : 6;
          const dest = this.pathfinder.getRandomWalkableFar(curTile.x, curTile.y, minDist);
          if (dest) {
            const path = this.pathfinder.findPath(curTile.x, curTile.y, dest.x, dest.y);
            if (path && path.length > 1) {
              npc.path = path; npc.pathIdx = 1;
              npc.aiState = 'walking'; npc._failedPaths = 0;
              npc._stuckFrames = 0;
              this._setNpcDir(npc);
            } else {
              npc._failedPaths++;
              npc.idleTimer = 1 + Math.random() * 2;  // wait longer before retry
            }
          }
        }
        break;

      case 'walking': {
        if (!npc.path || npc.pathIdx >= npc.path.length) {
          npc.aiState = 'idle';
          npc.idleTimer = 3 + Math.random() * 4;
          npc._curDir = 'idle'; npc._failedPaths = 0;
          npc._stuckFrames = 0;
          const r = Math.random();
          if (r < 0.3 && npc.frames.phone.length) {
            npc.sprite.textures = npc.frames.phone;
          } else if (r < 0.5 && npc.frames.reading.length) {
            npc.sprite.textures = npc.frames.reading;
          } else {
            npc.sprite.textures = npc.frames.idle;
          }
          npc.sprite.play();
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
          npc.idleTimer = 1 + Math.random() * 2;
          npc._stuckFrames = 0;
          npc._failedPaths++;
          npc._curDir = 'idle';
          npc.sprite.textures = npc.frames.idle;
          npc.sprite.play();
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
          this._removeBubble(npc);
          npc.aiState = 'idle'; npc.idleTimer = 1 + Math.random() * 2;
          npc._curDir = 'idle'; npc._failedPaths = 0;
          npc.sprite.textures = npc.frames.idle;
          npc.sprite.play();
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

    if (!npc.goldOutlines) {
      npc.goldOutlines = this._createGoldOutlineSprites(npc.sprite, npc.container, 2, 1);
    }
    npc.hasIssue = true;

    if (!npc.emoteSprite && this.spriteLoader.emoteFrames.length) {
      const emote = new PIXI.AnimatedSprite(this.spriteLoader.emoteFrames);
      emote.animationSpeed = 0.15;
      emote.anchor.set(0.5, 1);
      emote.scale.set(1.0);
      emote.y = -FH * NPC_SCALE - 8;
      emote.x = 8;
      emote.play();
      npc.container.addChild(emote);
      npc.emoteSprite = emote;
    }
  }

  _unfreezeNpc(npc) {
    if (!npc._guardFrozen) return;
    npc._guardFrozen = false;

    if (npc.mode === 'pathfind') {
      npc.aiState = 'idle';
      npc.idleTimer = 1 + Math.random() * 2;
    }

    if (npc.goldOutlines && !npc._originalHasIssue) {
      for (const os of npc.goldOutlines) {
        if (os.parent) os.parent.removeChild(os);
        os.destroy();
      }
      npc.goldOutlines = null;
    }
    if (npc.emoteSprite && !npc._originalHasIssue) {
      if (npc.emoteSprite.parent) npc.emoteSprite.parent.removeChild(npc.emoteSprite);
      npc.emoteSprite.destroy();
      npc.emoteSprite = null;
    }
    npc.hasIssue = npc._originalHasIssue || false;
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
      x: Math.round(this.sceneW * 0.13),
      y: Math.round(this.sceneH * 0.525),
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
      anim.scale.set(1.15);
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
    shadow.drawEllipse(0, -1, 10, 3.3);
    shadow.endFill();
    container.addChild(shadow);

    const spriteFrames = this._guardWalkFrames.length ? this._guardWalkFrames : this._guardIdleFrames;
    const body = new PIXI.AnimatedSprite(spriteFrames.length ? spriteFrames : [PIXI.Texture.WHITE]);
    body.anchor.set(0.5, 1);
    body.scale.set(1.05);
    body.animationSpeed = 0.16;
    if (spriteFrames.length) {
      body.play();
    } else {
      body.width = 14;
      body.height = 14;
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
    return latest.status === 'waiting' || latest.status === 'error' || this._waitingAgents.has(agent.id);
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
        x: gate.x + (slot - 2) * 8,
        y: gate.y - row * 6,
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
      if (evt.status === 'waiting') this._waitingAgents.add(agentId);
    }
  }

  _getAgentState(agent) {
    if (!agent) return 'offline';
    if (agent.status === 'running') return 'working';
    if (agent.status === 'idle')    return 'idle';
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
  }

  /** Clean up PixiJS resources. */
  destroy() {
    this._clearGuardsImmediate();
    this._resizeObs?.disconnect();
    this.app?.destroy(true, { children: true, texture: true, baseTexture: true });
    this.app = null;
  }
}
