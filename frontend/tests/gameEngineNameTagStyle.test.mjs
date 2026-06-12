import { describe, expect, test } from 'vitest';

import {
  NPC_NAME_TAG_FONT_SIZE,
  NPC_NAME_TAG_STROKE_THICKNESS,
  NPC_NAME_TAG_Y_GAP,
} from '../src/features/world/agent_town/engine/GameEngine.js';

describe('Agent Valley map name tags', () => {
  test('uses a readable map-scale label above each character', () => {
    expect(NPC_NAME_TAG_FONT_SIZE).toBeGreaterThanOrEqual(36);
    expect(NPC_NAME_TAG_FONT_SIZE).toBeLessThanOrEqual(44);
    expect(NPC_NAME_TAG_STROKE_THICKNESS).toBeGreaterThanOrEqual(4);
    expect(NPC_NAME_TAG_Y_GAP).toBeGreaterThanOrEqual(8);
  });
});
