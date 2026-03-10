// ── Frame dimensions ──
export const FW = 32;
export const FH = 64;

// ── NPC display ──
export const NPC_SCALE = 1.0;

// ── Asset paths (relative to public/) ──
export const CHAR_BASE = '/character_assets/';
export const EXCL_URL  = '/emotes/Exclamation_emote_16x16.png';

// ── Map configuration ──
export const MAP_MODE       = 'tiled';       // 'static' | 'tiled'
export const TILED_MAP_URL  = '/First_Map.tmj';
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
export const BUBBLE_MAX_CHARS = 48;

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
export const BG_COLOR = 0xF0EDE6;
