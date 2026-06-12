// lightning.js — lightning strikes carve crooked forks across the dome.
//
// Every few seconds a "bolt" is spawned at a random longitude and descends
// down the rings, branching with small lateral jitter. The bolt's LEDs hold
// full white for a few frames, then fade to a cool afterimage. A brief
// ambient flash brightens the whole dome the instant a bolt fires.

export const meta = {
  name: 'lightning',
  description: 'stormy dome with crooked lightning forks',
};

let levels = null; // per-LED cool-white intensity, decays each frame
let flash = 0;     // ambient dome flash from recent strike
let nextStrikeAt = 0;

function spawnBolt(ctx) {
  // Use ctx.strips so the pattern works in both ring and rib layouts.
  // In ring mode the bolt walks rim→apex (a natural lightning fork). In
  // rib mode it walks across ribs at the chosen longitude, which reads as
  // a horizontal zig-zag. `strip.startIndex` locates each strip in the
  // flat LED list.
  const strips = ctx.strips;
  const stripCount = strips.length;
  if (stripCount === 0) return;

  // Start longitude is random; wander a little as we walk through strips.
  let lon = Math.random() * Math.PI * 2;
  for (let r = 0; r < stripCount; r++) {
    const size = strips[r].ledCount;
    if (size === 0) continue;
    const start = strips[r].startIndex;
    // Turn lon into an LED index on this strip.
    const idx = Math.floor((lon / (Math.PI * 2)) * size) % size;

    // Core of the bolt + 1 LED on either side for some thickness.
    for (let d = -1; d <= 1; d++) {
      const k = start + (((idx + d) % size) + size) % size;
      const v = d === 0 ? 1.0 : 0.5;
      if (levels[k] < v) levels[k] = v;
    }

    // Rare forks: light up a second branch at a larger offset.
    if (r > 0 && Math.random() < 0.2) {
      const forkOffset = Math.floor(size * (0.04 + Math.random() * 0.06));
      const sign = Math.random() < 0.5 ? 1 : -1;
      const k = start + (((idx + sign * forkOffset) % size) + size) % size;
      if (levels[k] < 0.8) levels[k] = 0.8;
    }

    // Wander. Small random shift per strip.
    lon += (Math.random() - 0.5) * 0.4;
  }
  flash = 0.6;
}

export function setup(ctx) {
  levels = new Float32Array(ctx.ledCount);
  flash = 0;
  nextStrikeAt = 0;
}

export function render(ctx, out) {
  if (!levels || levels.length !== ctx.ledCount) setup(ctx);

  if (ctx.time >= nextStrikeAt) {
    spawnBolt(ctx);
    nextStrikeAt = ctx.time + 0.8 + Math.random() * 2.5;
  }

  // Bolt core fades fast; ambient flash fades fastest.
  const boltDecay = Math.exp(-ctx.dt / 0.18);
  flash *= Math.exp(-ctx.dt / 0.08);

  for (let i = 0; i < ctx.ledCount; i++) {
    levels[i] *= boltDecay;
    const bolt = levels[i];
    // Cool white core + faint blue ambient flash baseline.
    const v = Math.min(1, bolt + flash * 0.25);
    out[i * 3 + 0] = 200 * v;
    out[i * 3 + 1] = 220 * v;
    out[i * 3 + 2] = 255 * v;
  }
}
