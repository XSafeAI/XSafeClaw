// ── Frame dimensions ──
export const FW = 32;
export const FH = 64;

// ── NPC display ──
export const NPC_SCALE = 3.9;

// ── Data source mode ──
export const USE_AGENT_TOWN_MOCK = false;

// ── Background music ──
export const MUSIC_TRACKS = [
  {
    id: 'home',
    label: 'Home',
    fileName: 'toby fox - UNDERTALE Soundtrack - 12 Home.mp3',
    url: '/music/toby fox - UNDERTALE Soundtrack - 12 Home.mp3',
  },
  {
    id: 'undertale',
    label: 'Undertale',
    fileName: 'toby fox - UNDERTALE Soundtrack - 71 Undertale.mp3',
    url: '/music/toby fox - UNDERTALE Soundtrack - 71 Undertale.mp3',
  },
];

// ── Asset paths (relative to public/) ──
export const CHAR_BASE = '/character_assets/';
export const EXCL_URL  = '/emotes/Exclamation_emote_16x16.png';

// ── Map configuration ──
export const MAP_MODE       = 'tiled';       // 'static' | 'tiled'
export const MAP_VARIANTS = [
  {
    id: 'map1',
    label: 'Classic',
    description: 'Original office mood with the classic palette.',
    mapUrl: '/Map/Map_opensource.tmj',
    previewImage: '/Map/Map-demo/Map1-demo.png',
    screenPreviewImage: '/Map/Map-demo/Map1_v2.png',
    visualLayer: 'Map1',
    tilesetName: 'Map1_V2',
    imageAsset: '/Map/Map1_V2.png',
    collisionLayer: 'collision-Map1',
    screenLayerName: 'screen',
    dashboardLayerName: 'dashboard',
    renderMode: 'whole-image',
    tileWidth: 32,
    tileHeight: 32,
    width: 172,
    height: 100,
  },
  {
    id: 'map2',
    label: 'Cyberpunk',
    description: 'Neon cyberpunk lighting with the same playable layout.',
    mapUrl: '/Map/Map_opensource.tmj',
    previewImage: '/Map/Map-demo/Map2-demo.png',
    visualLayer: 'Map2',
    tilesetName: 'Map2_Final',
    imageAsset: '/Map/Map2_Final.png',
    collisionLayer: 'collision-Map2',
    screenLayerName: null,
    dashboardLayerName: null,
    renderMode: 'whole-image',
    tileWidth: 32,
    tileHeight: 32,
    width: 172,
    height: 100,
  },
  {
    id: 'map3',
    label: 'Mechanical',
    description: 'Heavy mechanical factory skin with industrial accents.',
    mapUrl: '/Map/Map_opensource.tmj',
    previewImage: '/Map/Map-demo/Map3-demo.png',
    visualLayer: 'Map3',
    tilesetName: 'Map3',
    imageAsset: '/Map/Map3.png',
    collisionLayer: 'collision-Map3',
    screenLayerName: null,
    dashboardLayerName: null,
    renderMode: 'whole-image',
    tileWidth: 32,
    tileHeight: 32,
    width: 172,
    height: 100,
  },
];
export const DEFAULT_MAP_CONFIG = MAP_VARIANTS[0];
export const TILED_MAP_URL  = DEFAULT_MAP_CONFIG.mapUrl;
export const TILED_BASE_PATH = '';

// ── Static mode fallback ──
export const SCENE_IMAGE_URL = '/dashboard/scenes/scene_office2.png';
export const SCENE_W = 512;
export const SCENE_H = 544;

// ── Character names (determines how many NPCs can appear) ──
export const CHAR_NAMES = [
  'Adam','Amelia','Bob','Lucy','Edward','Dan','Ash','Bruce',
  'Molly','Rob','Roki','Samuel','Alex','Pier','Conference_man',
  'Bouncer','Doctor_1','Nurse_1','Old_man_Josh','Old_woman_Jenny',
];

// ── NPC meeting interaction ──
export const MEETING_DIST     = 40;   // pixel distance to trigger
export const MEETING_TIME     = 4;    // seconds NPCs chat
export const MEETING_COOLDOWN = 60;   // seconds before the same pair can chat again
export const BUBBLE_MAX_CHARS = 96;

// ── Walk zones (static mode patrol paths) ──
export const WALK_ZONES = [
  { x: 62,  yA: 105, yB: 190 }, { x: 92,  yA: 110, yB: 195 },
  { x: 248, yA: 295, yB: 400 }, { x: 275, yA: 295, yB: 405 },
  { x: 62,  yA: 345, yB: 435 }, { x: 145, yA: 340, yB: 435 },
  { x: 310, yA: 120, yB: 200 }, { x: 340, yA: 120, yB: 195 },
  { x: 440, yA: 340, yB: 420 }, { x: 458, yA: 340, yB: 420 },
  { x: 385, yA: 120, yB: 200 }, { x: 420, yA: 120, yB: 200 },
  { x: 175, yA: 300, yB: 400 }, { x: 200, yA: 300, yB: 400 },
  { x: 350, yA: 295, yB: 410 }, { x: 380, yA: 290, yB: 410 },
  { x: 120, yA: 115, yB: 195 }, { x: 155, yA: 115, yB: 195 },
  { x: 460, yA: 120, yB: 200 }, { x: 490, yA: 120, yB: 195 },
];

// ── PixiJS background ──
export const BG_COLOR = 0xF7F6F2;
