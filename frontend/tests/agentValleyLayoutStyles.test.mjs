import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  FLOOR_SCREEN_GUARD_STATUS_FONT_MIN,
  FLOOR_SCREEN_HERO_SUB_FONT_MIN,
  FLOOR_SCREEN_LABEL_FONT_MIN,
  FLOOR_SCREEN_PANEL_TITLE_FONT_MIN,
  FLOOR_SCREEN_ROW_LABEL_FONT_MIN,
  FLOOR_SCREEN_ROW_VALUE_FONT_MIN,
  FLOOR_SCREEN_WARNING_COUNT_FONT_MIN,
} from '../src/features/world/agent_town/engine/GameEngine.js';

const appCss = readFileSync(
  resolve(__dirname, '../src/features/world/agent_town/App.css'),
  'utf8',
);
const appJsx = readFileSync(
  resolve(__dirname, '../src/features/world/agent_town/App.jsx'),
  'utf8',
);

describe('Agent Valley overlay layout', () => {
  test('keeps the HUD compact instead of moving it down over the console close button', () => {
    expect(appJsx).not.toContain('town-hud-console-open');
    expect(appCss).not.toMatch(/\.town-hud-console-open/);
    expect(appCss).toMatch(/\.town-hud\s*\{[^}]*top:\s*14px;[^}]*padding:\s*3px 4px;/s);
    expect(appCss).toMatch(/\.town-hud-btn\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;/s);
    expect(appCss).toMatch(/\.town-hud-home\s*\{[^}]*width:\s*42px;/s);
  });

  test('keeps floor display text large enough after map scaling', () => {
    expect(FLOOR_SCREEN_LABEL_FONT_MIN).toBeGreaterThanOrEqual(22);
    expect(FLOOR_SCREEN_PANEL_TITLE_FONT_MIN).toBeGreaterThanOrEqual(26);
    expect(FLOOR_SCREEN_ROW_LABEL_FONT_MIN).toBeGreaterThanOrEqual(24);
    expect(FLOOR_SCREEN_ROW_VALUE_FONT_MIN).toBeGreaterThanOrEqual(64);
    expect(FLOOR_SCREEN_HERO_SUB_FONT_MIN).toBeGreaterThanOrEqual(26);
    expect(FLOOR_SCREEN_GUARD_STATUS_FONT_MIN).toBeGreaterThanOrEqual(18);
    expect(FLOOR_SCREEN_WARNING_COUNT_FONT_MIN).toBeGreaterThanOrEqual(24);
  });
});
