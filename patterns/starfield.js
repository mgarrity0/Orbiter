// starfield.js — random LEDs twinkle on with warm-white starlight, fade out.
//
// Each LED runs its own exponential decay. Every frame we pick a handful of
// fresh "stars" at random and light them fully. Over time the dome looks like
// a slow-breathing constellation. Deterministic per-LED jitter keeps some
// stars warmer (dim red-giants) and some cooler (bluish supergiants).

export const meta = {
  name: 'starfield',
  description: 'slow-twinkling warm stars scattered across the dome',
};

// Per-LED brightness, kept across frames. Reallocated in setup() when the
// LED count changes.
let levels = null;

// Per-LED color temperature bias in [-1, 1]. Negative = warmer, positive = cooler.
let warmth = null;

// Indices of the hole-dot LEDs. Drilled points read as stars far better
// than strip LEDs, so half of all star births land on them even though
// they're a small fraction of the chain.
let dotIdx = null;

export function setup(ctx) {
  levels = new Float32Array(ctx.ledCount);
  warmth = new Float32Array(ctx.ledCount);
  const dots = [];
  for (let i = 0; i < ctx.ledCount; i++) {
    // Cheap hash to spread temperatures consistently across LEDs.
    const h = Math.sin(i * 12.9898) * 43758.5453;
    warmth[i] = (h - Math.floor(h)) * 2 - 1;
    if (ctx.leds[i].kind === 'points') dots.push(i);
  }
  dotIdx = dots;
}

export function render(ctx, out) {
  if (!levels || levels.length !== ctx.ledCount) setup(ctx);

  // ~1.2 new stars per 100 LEDs per second (≈90/s on the default orb), so the
  // field density scales with the structure.
  const birthsPerSec = Math.max(12, ctx.ledCount * 0.012);
  const births = Math.floor(birthsPerSec * ctx.dt + Math.random());
  // Bias births toward the drilled-hole dots — they're the marquee LEDs and
  // read as stars best — but only a few times their share of the chain, and
  // capped, so they twinkle instead of saturating to an always-on ring (a
  // flat 50% on a few hundred dots keeps every one of them permanently lit).
  const dotProb = dotIdx.length ? Math.min(0.3, (dotIdx.length / ctx.ledCount) * 4) : 0;
  for (let n = 0; n < births; n++) {
    const useDot = Math.random() < dotProb;
    const i = useDot
      ? dotIdx[(Math.random() * dotIdx.length) | 0]
      : (Math.random() * ctx.ledCount) | 0;
    // Some stars flare brighter than others.
    levels[i] = 0.5 + Math.random() * 0.5;
  }

  // Decay constant: ~1.5s half-life.
  const decay = Math.exp(-ctx.dt / 1.5);

  for (let i = 0; i < ctx.ledCount; i++) {
    levels[i] *= decay;
    const v = levels[i];
    if (v < 0.005) {
      out[i * 3 + 0] = 0;
      out[i * 3 + 1] = 0;
      out[i * 3 + 2] = 0;
      continue;
    }
    // Base warm white (3200K-ish), push toward red or blue by warmth.
    const w = warmth[i];
    const r = 255 * v * (w < 0 ? 1 : 1 - w * 0.4);
    const g = 210 * v;
    const b = 160 * v * (w > 0 ? 1 + w * 0.6 : 1);
    out[i * 3 + 0] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
}
