// rainstorm.js — raindrops streak down the dome from rim to apex.
//
// Ring 0 is the rim (top opening at y=0); the last ring is near the apex
// (bottom at y≈-r). Each drop is a short trail of LEDs that walks downward
// from ring 0 toward the apex at roughly its own speed. The head is bright
// cool-blue, the tail fades to deep teal. New drops spawn at a steady rate.
// The whole thing sits on a dark bluish ambient so the dome looks wet
// between drops.

export const meta = {
  name: 'rainstorm',
  description: 'raindrops streak from rim to apex',
};

const MAX_DROPS = 80;
let drops = [];

function spawnDrop(ctx) {
  const rings = ctx.structure.rings;
  if (rings.length === 0) return;
  // Pick a longitude in radians; we'll convert per-ring.
  const lon = Math.random() * Math.PI * 2;
  drops.push({
    lon,
    // Start just above the rim (ring 0).
    pos: -0.5,
    // Drops cross the dome in ~0.9–1.6s.
    speed: rings.length / (0.9 + Math.random() * 0.7),
    bright: 0.7 + Math.random() * 0.3,
  });
}

export function setup() {
  drops = [];
}

export function render(ctx, out) {
  const rings = ctx.structure.rings;
  const ringCount = rings.length;

  // Per-ring start index into the flat LED list.
  const ringStart = new Int32Array(ringCount);
  let acc = 0;
  for (let r = 0; r < ringCount; r++) {
    ringStart[r] = acc;
    acc += rings[r].ledCount;
  }

  // Ambient dark-teal wash, very dim.
  for (let i = 0; i < ctx.ledCount; i++) {
    out[i * 3 + 0] = 3;
    out[i * 3 + 1] = 10;
    out[i * 3 + 2] = 22;
  }

  // Spawn new drops. Rate scales with ring count to keep density roughly
  // consistent across dome sizes.
  const ratePerSec = Math.max(8, ringCount * 4);
  const births = Math.floor(ratePerSec * ctx.dt + Math.random());
  for (let n = 0; n < births && drops.length < MAX_DROPS; n++) {
    spawnDrop(ctx);
  }

  // Advance and draw each drop. pos increases as the drop falls from
  // rim (ring 0) toward apex (ringCount-1).
  const tailRings = 2.8; // how many rings long a drop's tail is
  for (let d = drops.length - 1; d >= 0; d--) {
    drops[d].pos += drops[d].speed * ctx.dt;
    if (drops[d].pos > ringCount + tailRings) {
      drops.splice(d, 1);
      continue;
    }
  }

  for (let d = 0; d < drops.length; d++) {
    const drop = drops[d];

    // Draw head and tail: for each ring within tailRings of drop.pos, light
    // the nearest LED to drop.lon with fade proportional to distance behind
    // the head.
    const lowR = Math.max(0, Math.floor(drop.pos - tailRings));
    const highR = Math.min(ringCount - 1, Math.ceil(drop.pos));
    for (let r = lowR; r <= highR; r++) {
      const dist = drop.pos - r; // >0 means drop has passed this ring (tail)
      if (dist < 0 || dist > tailRings) continue;
      // Head is brightest at dist ~ 0, tail fades as dist grows.
      const fade = 1 - dist / tailRings;
      const v = drop.bright * fade * fade;
      const size = rings[r].ledCount;
      if (size === 0) continue;
      const idx = Math.floor((drop.lon / (Math.PI * 2)) * size) % size;
      const i = ringStart[r] + ((idx + size) % size);
      // Head is cool white-blue, tail is deeper teal.
      const headness = fade;
      const r8 = 30 * v * headness;
      const g8 = (90 + 80 * headness) * v;
      const b8 = (200 + 55 * headness) * v;
      out[i * 3 + 0] = Math.max(out[i * 3 + 0], r8);
      out[i * 3 + 1] = Math.max(out[i * 3 + 1], g8);
      out[i * 3 + 2] = Math.max(out[i * 3 + 2], b8);
    }
  }
}
