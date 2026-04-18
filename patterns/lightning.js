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
  const rings = ctx.structure.rings;
  const ringCount = rings.length;
  if (ringCount === 0) return;

  // Build a per-ring offset table so we can jump into the flat LED list by ring.
  const ringStart = new Int32Array(ringCount);
  let acc = 0;
  for (let r = 0; r < ringCount; r++) {
    ringStart[r] = acc;
    acc += rings[r].ledCount;
  }

  // Start longitude is random; wander a little as we walk down through the
  // rings (ring 0 = rim at top, last ring = apex at bottom).
  let lon = Math.random() * Math.PI * 2;
  for (let r = 0; r < ringCount; r++) {
    const size = rings[r].ledCount;
    if (size === 0) continue;
    // Turn lon into an LED index on this ring.
    const idx = Math.floor((lon / (Math.PI * 2)) * size) % size;

    // Core of the bolt + 1 LED on either side for some thickness.
    for (let d = -1; d <= 1; d++) {
      const k = ringStart[r] + (((idx + d) % size) + size) % size;
      const v = d === 0 ? 1.0 : 0.5;
      if (levels[k] < v) levels[k] = v;
    }

    // Rare forks: light up a second branch at a larger offset.
    if (r > 0 && Math.random() < 0.2) {
      const forkOffset = Math.floor(size * (0.04 + Math.random() * 0.06));
      const sign = Math.random() < 0.5 ? 1 : -1;
      const k = ringStart[r] + (((idx + sign * forkOffset) % size) + size) % size;
      if (levels[k] < 0.8) levels[k] = 0.8;
    }

    // Wander. Small random shift per ring.
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
