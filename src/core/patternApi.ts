// Public API a pattern file on disk sees.
//
// A pattern is a plain ES module — anything importable by a browser. The
// canonical shape is:
//
//   export const meta = { name: 'solid', description: 'one color' };
//   export function setup(ctx) { /* optional, called once on load */ }
//   export function render(ctx, out) {
//     // out is a Uint8ClampedArray of length ctx.leds.length * 3
//     // out[i*3+0..2] = [r, g, b] in linear 8-bit
//   }
//
// We pass `ctx.leds` so patterns can do lat/lon-aware effects without having
// to re-derive geometry. `time` and `dt` are in seconds; `frame` counts from
// 0 at activation.

import type { Led, Strip, Structure } from './structure';
import type { MotionState } from './motion';
import type { AudioState } from './audio';

// Shared HSV→RGB writer, exposed to patterns as `ctx.hsv`. h/s/v in [0,1];
// writes 8-bit RGB into out[off..off+2] without allocating (an allocating
// per-LED converter costs ~120k throwaway arrays/sec at 2k LEDs @ 60fps).
// It lives on the context because patterns load as blob-URL modules and
// cannot import shared code.
export function writeHsv(
  out: Uint8ClampedArray,
  off: number,
  h: number,
  s: number,
  v: number,
): void {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (((i % 6) + 6) % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  out[off + 0] = r * 255;
  out[off + 1] = g * 255;
  out[off + 2] = b * 255;
}

// `strips` is a derived per-strip list that is always correct for the
// active layout — in ring mode it mirrors structure.rings, in rib mode it
// is the channel strips followed by the per-rib hole-LED strips (check
// `strip.kind` to tell them apart). Each strip carries `startIndex`, its
// first LED in the flat list — use it instead of summing ledCounts.
// Patterns should prefer `strips` over reading `structure.rings` directly
// if they care about both layouts.
export type RenderContext = {
  time: number;
  dt: number;
  frame: number;
  structure: Structure;
  leds: Led[];
  ledCount: number;
  strips: Strip[];
  motion: MotionState;
  audio: AudioState;
  hsv: typeof writeHsv;
};

export type SetupContext = {
  structure: Structure;
  leds: Led[];
  ledCount: number;
  strips: Strip[];
};

export type PatternMeta = {
  name?: string;
  description?: string;
  author?: string;
};

export type PatternModule = {
  meta?: PatternMeta;
  setup?: (ctx: SetupContext) => void;
  render: (ctx: RenderContext, out: Uint8ClampedArray) => void;
};

export function isPatternModule(mod: unknown): mod is PatternModule {
  return !!mod && typeof (mod as PatternModule).render === 'function';
}
