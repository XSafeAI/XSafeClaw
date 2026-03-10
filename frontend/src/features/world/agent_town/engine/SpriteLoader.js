import * as PIXI from 'pixi.js';
import { FW, FH, CHAR_BASE, CHAR_NAMES, EXCL_URL } from '../config/constants';

/**
 * Loads all character sprite sheets and builds frame maps.
 *
 * Sheet layouts (per sprite_config.json):
 *   _idle_anim / _run: 24 frames of 32×64, grouped in 6:
 *     [0-5] right, [6-11] back, [12-17] left, [18-23] front
 *   _phone: 9 frames of 32×64 (front-facing)
 *   _reading: 18 frames of 32×64 (front-facing)
 */
export default class SpriteLoader {
  constructor() {
    /** @type {Record<string, CharFrames>} */
    this.charFrames = {};
    /** @type {PIXI.Texture[]} */
    this.emoteFrames = [];
  }

  /** Load all character sheets. onProgress(0-1) for UI feedback. */
  async load(onProgress) {
    PIXI.BaseTexture.defaultOptions.scaleMode = PIXI.SCALE_MODES.NEAREST;

    // Core assets (must load)
    const coreUrls = [EXCL_URL];
    const optionalUrls = [];

    for (const name of CHAR_NAMES) {
      coreUrls.push(CHAR_BASE + name + '_run_32x32.png');
      coreUrls.push(CHAR_BASE + name + '_idle_anim_32x32.png');
      optionalUrls.push(CHAR_BASE + name + '_phone_32x32.png');
      optionalUrls.push(CHAR_BASE + name + '_reading_32x32.png');
    }

    await PIXI.Assets.load(coreUrls, (p) => onProgress?.(p * 0.8))
      .catch(() => console.warn('Some core assets failed to load'));

    // Optional (phone/reading) — don't block on failure
    await Promise.allSettled(optionalUrls.map(u => PIXI.Assets.load(u)));
    onProgress?.(1);

    this._buildFrames();
    this._buildEmoteFrames();
  }

  _buildFrames() {
    for (const name of CHAR_NAMES) {
      const runUrl     = CHAR_BASE + name + '_run_32x32.png';
      const idleUrl    = CHAR_BASE + name + '_idle_anim_32x32.png';
      const phoneUrl   = CHAR_BASE + name + '_phone_32x32.png';
      const readingUrl = CHAR_BASE + name + '_reading_32x32.png';

      try {
        const runBT  = PIXI.BaseTexture.from(runUrl);
        const idleBT = PIXI.BaseTexture.from(idleUrl);
        runBT.scaleMode  = PIXI.SCALE_MODES.NEAREST;
        idleBT.scaleMode = PIXI.SCALE_MODES.NEAREST;

        const cut = (bt, start, end) => {
          const arr = [];
          for (let i = start; i < end; i++)
            arr.push(new PIXI.Texture(bt, new PIXI.Rectangle(i * FW, 0, FW, FH)));
          return arr;
        };

        // Running directions
        const right = cut(runBT, 0, 6);
        const back  = cut(runBT, 6, 12);
        const left  = cut(runBT, 12, 18);
        const front = cut(runBT, 18, 24);

        // Idle directions
        const idleRight = cut(idleBT, 0, 6);
        const idleBack  = cut(idleBT, 6, 12);
        const idleLeft  = cut(idleBT, 12, 18);
        const idleFront = cut(idleBT, 18, 24);
        const idle = [...idleFront];

        // Optional: phone (9 frames) & reading (18 frames)
        let phone = [];
        try {
          const bt = PIXI.BaseTexture.from(phoneUrl);
          if (bt && bt.valid) { bt.scaleMode = PIXI.SCALE_MODES.NEAREST; phone = cut(bt, 0, 9); }
        } catch (_) {}

        let reading = [];
        try {
          const bt = PIXI.BaseTexture.from(readingUrl);
          if (bt && bt.valid) { bt.scaleMode = PIXI.SCALE_MODES.NEAREST; reading = cut(bt, 0, 18); }
        } catch (_) {}

        this.charFrames[name] = {
          front, back, left, right,
          idle, idleRight, idleBack, idleLeft, idleFront,
          phone, reading,
        };
      } catch (e) {
        console.warn('SpriteLoader: failed to build frames for', name, e);
      }
    }
  }

  _buildEmoteFrames() {
    try {
      const bt = PIXI.BaseTexture.from(EXCL_URL);
      bt.scaleMode = PIXI.SCALE_MODES.NEAREST;
      for (let i = 0; i < 4; i++)
        this.emoteFrames.push(new PIXI.Texture(bt, new PIXI.Rectangle(i * 16, 0, 16, 16)));
    } catch (_) {}
  }
}
