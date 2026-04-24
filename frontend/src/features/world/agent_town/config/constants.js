// ── Frame dimensions ──
export const FW = 32;
export const FH = 64;

// ── NPC display ──
export const NPC_SCALE = 3.9;

// ── Data source mode ──
export const USE_AGENT_TOWN_MOCK = false;

// ── Demo mode (env var, default ON) ──
export const DEMO_MODE = (import.meta.env.VITE_DEMO_MODE ?? 'false') === 'true';
export const DEMO_CHAR_NAME = 'Lucy';
const _demoSessionKeys = new Set(JSON.parse(localStorage.getItem('_demo_sessions') || '[]'));
function _normKey(k) {
  const s = String(k || '');
  return s.startsWith('agent:main:') ? s.slice('agent:main:'.length) : s;
}
function _persistDemo() {
  try { localStorage.setItem('_demo_sessions', JSON.stringify([..._demoSessionKeys])); } catch (_) {}
}
export function markDemoSession(sessionKey) {
  if (!sessionKey) return;
  _demoSessionKeys.add(_normKey(sessionKey));
  _persistDemo();
}
export function isDemoSession(sessionKey) {
  if (!sessionKey) return false;
  return _demoSessionKeys.has(_normKey(sessionKey));
}
export function removeDemoSession(sessionKey) {
  if (!sessionKey) return;
  _demoSessionKeys.delete(_normKey(sessionKey));
  _persistDemo();
}

// ── Background music ──
export const MUSIC_TRACKS = [
  {
    id: 'bright-steps',
    label: 'Bright Steps',
    fileName: 'bright-steps.mp3',
    url: '/music/bright-steps.mp3',
  },
  {
    id: 'golden-parade',
    label: 'Golden Parade',
    fileName: 'golden-parade.mp3',
    url: '/music/golden-parade.mp3',
  },
  {
    id: 'quiet-breeze',
    label: 'Quiet Breeze',
    fileName: 'quiet-breeze.mp3',
    url: '/music/quiet-breeze.mp3',
  },
  {
    id: 'evening-glow',
    label: 'Evening Glow',
    fileName: 'evening-glow.mp3',
    url: '/music/evening-glow.mp3',
  },
  {
    id: 'royal-court',
    label: 'Royal Court',
    fileName: 'royal-court.mp3',
    url: '/music/royal-court.mp3',
  },
];

// ── Asset paths (relative to public/) ──
export const CHAR_BASE = '/character_assets/';

// ── Map configuration ──
/** All skins load from the same Tiled pack; PNGs + `Map_demo` previews live under `public/Map-opensorce/`. */
const MAP_OPENSOURCE_BASE = '/Map-opensorce';
const MAP_DEMO = `${MAP_OPENSOURCE_BASE}/Map_demo`;

export const MAP_ASSETS_BASE = 'http://xsafeclaw.ai/assets/Map-opensorce';

export const MAP_MODE       = 'tiled';       // 'static' | 'tiled'
export const MAP_VARIANTS = [
  {
    id: 'map1',
    label: 'Classic',
    bundled: true,
    description: 'Office floor with screen + dashboard overlays and stage NPC layer.',
    mapUrl: `${MAP_OPENSOURCE_BASE}/Map_opensource.tmj`,
    previewImage: `${MAP_DEMO}/Map1.png`,
    screenPreviewImage: `${MAP_DEMO}/Map1.png`,
    visualLayer: 'Map1',
    tilesetName: 'Map1',
    imageAsset: `${MAP_OPENSOURCE_BASE}/Map1.png`,
    collisionLayer: 'collision-Map1',
    screenLayerName: 'screen',
    dashboardLayerName: 'dashboard',
    showLayerName: 'npc',
    showNpcCharName: 'Roki',
    showEasterEggImage: '/sup/Phd_Ding_sit.png',
    showEasterEggMessage: 'we will',
    showNpcOffsetX: -20,
    showNpcOffsetY: 0,
    renderMode: 'whole-image',
    tileWidth: 32,
    tileHeight: 32,
    width: 172,
    height: 100,
  },
  {
    id: 'map2',
    label: 'Cyberpunk',
    bundled: false,
    description: 'Neon skin; same walkable layout, `filed_npc` crowd layer.',
    mapUrl: `${MAP_OPENSOURCE_BASE}/Map_opensource.tmj`,
    previewImage: `${MAP_DEMO}/Map2.png`,
    screenPreviewImage: `${MAP_DEMO}/Map2.png`,
    visualLayer: 'Map2',
    tilesetName: 'Map2',
    imageAsset: `${MAP_OPENSOURCE_BASE}/Map2.png`,
    collisionLayer: 'collision-Map2',
    screenLayerName: null,
    dashboardLayerName: null,
    showLayerName: 'npc',
    showNpcCharName: 'Roki',
    showEasterEggImage: null,
    showEasterEggMessage: 'we will',
    renderMode: 'whole-image',
    tileWidth: 32,
    tileHeight: 32,
    width: 172,
    height: 100,
  },
  {
    id: 'map3',
    label: 'Mechanical',
    bundled: false,
    description: 'Industrial palette with extra door cover collision.',
    mapUrl: `${MAP_OPENSOURCE_BASE}/Map_opensource.tmj`,
    previewImage: `${MAP_DEMO}/Map3.png`,
    screenPreviewImage: `${MAP_DEMO}/Map3.png`,
    visualLayer: 'Map3',
    tilesetName: 'Map3',
    imageAsset: `${MAP_OPENSOURCE_BASE}/Map3.png`,
    collisionLayer: 'collision-Map3',
    screenLayerName: null,
    dashboardLayerName: null,
    showLayerName: null,
    showEasterEggImage: null,
    showEasterEggMessage: null,
    overlayLayerName: 'Doorcover3',
    renderMode: 'whole-image',
    tileWidth: 32,
    tileHeight: 32,
    width: 172,
    height: 100,
  },
  {
    id: 'map4',
    label: 'Imperial',
    bundled: false,
    description: 'Chinese palace mood — courtyards, vermilion columns, gilded eaves.',
    mapUrl: `${MAP_OPENSOURCE_BASE}/Map_opensource.tmj`,
    previewImage: `${MAP_DEMO}/Map4.png`,
    screenPreviewImage: `${MAP_DEMO}/Map4.png`,
    visualLayer: 'Map4',
    tilesetName: 'Map4',
    imageAsset: `${MAP_OPENSOURCE_BASE}/Map4.png`,
    collisionLayer: 'collision-Map4',
    screenLayerName: null,
    dashboardLayerName: null,
    showLayerName: null,
    showEasterEggImage: null,
    showEasterEggMessage: null,
    creatorEasterEggs: [
      {
        layerName: 'npc1',
        idleImage: '/sup/Creator Set/npc2.png',
        responseImage: '/sup/Creator Set/npc2_back.png',
      },
      {
        layerName: 'npc2',
        idleImage: '/sup/Creator Set/npc1.png',
        responseImage: '/sup/Creator Set/npc1_back.png',
      },
    ],
    renderMode: 'whole-image',
    tileWidth: 32,
    tileHeight: 32,
    width: 172,
    height: 100,
  },
  {
    id: 'map5',
    label: 'Baroque',
    bundled: false,
    description: 'European palace interior — marble floors, arches, and ornate gilding.',
    mapUrl: `${MAP_OPENSOURCE_BASE}/Map_opensource.tmj`,
    previewImage: `${MAP_DEMO}/Map5.png`,
    screenPreviewImage: `${MAP_DEMO}/Map5.png`,
    visualLayer: 'Map5',
    tilesetName: 'Map5',
    imageAsset: `${MAP_OPENSOURCE_BASE}/Map5.png`,
    collisionLayer: 'collision-Map5',
    screenLayerName: null,
    dashboardLayerName: null,
    showLayerName: null,
    showEasterEggImage: null,
    showEasterEggMessage: null,
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

/** JSON array of `{ text, response? }` for double-tap on map `filed_npc` tiles. */
export const FIELD_NPC_DIALOGUE_URL = '/Map-opensorce/dialogue.json';
/** Max distance (px) from tap to an agent for `response` NPC line. */
export const FIELD_NPC_RESPONSE_NEAR_PX = 220;

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

export const AGENT_PERSON_NAMES = [
  'Tom','Jerry','Kirco','Mira','Nora','Iris','Leo','Ada',
  'Theo','Mina','Rex','Lina','Owen','Juno','Kai','Vera',
  'Noah','Zara','Milo','Eli',
];

function hashStableIndex(key, total) {
  if (!total) return 0;
  let h = 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return ((h % total) + total) % total;
}

export function inferAgentRuntime(agent = {}) {
  const platform = String(agent?.platform || '').trim().toLowerCase();
  const instanceId = String(agent?.instance_id || '').trim().toLowerCase();
  const sessionKey = String(agent?.session_key || '').trim().toLowerCase();

  if (platform === 'nanobot' || instanceId.startsWith('nanobot') || sessionKey.startsWith('nanobot::')) return 'nanobot';
  if (platform === 'hermes' || instanceId.startsWith('hermes') || sessionKey.startsWith('hermes::')) return 'hermes';
  if (platform === 'openclaw' || instanceId.startsWith('openclaw') || sessionKey.startsWith('openclaw::')) return 'openclaw';
  return platform || 'openclaw';
}

export function pickAgentPersonName(agent = {}) {
  const key = agent?.session_key || agent?.id || agent?.pid || agent?.name || '';
  return AGENT_PERSON_NAMES[hashStableIndex(key, AGENT_PERSON_NAMES.length)];
}

export function formatAgentDisplayName(agent = {}) {
  return `${inferAgentRuntime(agent)}「${pickAgentPersonName(agent)}」`;
}

/** Deterministic agent->character index from key hash (stable across list reordering). */
export function hashAgentCharIndex(key) {
  let h = 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return ((h % CHAR_NAMES.length) + CHAR_NAMES.length) % CHAR_NAMES.length;
}

/**
 * Build a stable agentId -> charName map.
 * Hashes each ID for a base index, resolves collisions in sorted-ID order.
 */
export function buildStableCharNameMap(agents) {
  const map = {};
  const used = new Set();
  const total = CHAR_NAMES.length;
  const sorted = [...(agents || [])]
    .filter((agent) => agent?.id)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  for (const agent of sorted) {
    const base = hashAgentCharIndex(agent.session_key || agent.id);
    let idx = base;
    if (used.has(idx)) {
      for (let j = 1; j < total; j += 1) {
        const candidate = (base + j) % total;
        if (!used.has(candidate)) {
          idx = candidate;
          break;
        }
      }
    }
    used.add(idx);
    map[agent.id] = CHAR_NAMES[idx];
  }

  return { map, used };
}

// ── NPC meeting interaction ──
export const MEETING_DIST     = 40;   // pixel distance to trigger
export const MEETING_TIME     = 4;    // seconds NPCs chat
export const MEETING_COOLDOWN = 60;   // seconds before the same pair can chat again
export const BUBBLE_MAX_CHARS = 60;

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
// Match the darker page backdrop so transparent map edges do not show a light seam.
export const BG_COLOR = 0x211928;
