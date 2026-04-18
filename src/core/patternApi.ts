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

import type { Led, Structure } from './structure';
import type { MotionState } from './motion';
import type { AudioState } from './audio';

export type RenderContext = {
  time: number;
  dt: number;
  frame: number;
  structure: Structure;
  leds: Led[];
  ledCount: number;
  motion: MotionState;
  audio: AudioState;
};

export type SetupContext = {
  structure: Structure;
  leds: Led[];
  ledCount: number;
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
