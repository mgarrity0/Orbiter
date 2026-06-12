// rainstorm.js — raindrops streak down the dome from rim to apex.
//
// Uses `ctx.strips` (the active strip list) rather than `ctx.structure.rings`
// so this pattern works in both ring and rib layouts. Semantically: a drop
// walks through "strip indices" at a random longitude — in ring mode that's
// rim→apex motion, in rib mode that's "strip n lights up, strip n+1 lights
// up, …" which reads as a circular sweep around the dome. Both are musical.

export const meta = {
  name: 'rainstorm',
  description: 'raindrops streak from rim to apex',
};

const MAX_DROPS = 80;
let drops = [];

function spawnDrop(ctx) {
  const strips = ctx.strips;
  if (strips.length === 0) return;
  // Pick a longitude in radians; we'll convert per-strip.
  const lon = Math.random() * Math.PI * 2;
  drops.push({
    lon,
    // Start just above the first strip.
    pos: -0.5,
    // Drops cross the dome in ~0.9–1.6s.
    speed: strips.length / (0.9 + Math.random() * 0.7),
    bright: 0.7 + Math.random() * 0.3,
  });
}

export function setup() {
  drops = [];
}

export function render(ctx, out) {
  const strips = ctx.strips;
  const stripCount = strips.length;

  // Ambient dark-teal wash, very dim.
  for (let i = 0; i < ctx.ledCount; i++) {
    out[i * 3 + 0] = 3;
    out[i * 3 + 1] = 10;
    out[i * 3 + 2] = 22;
  }

  // Spawn new drops. Rate scales with strip count to keep density roughly
  // consistent across dome sizes.
  const ratePerSec = Math.max(8, stripCount * 4);
  const births = Math.floor(ratePerSec * ctx.dt + Math.random());
  for (let n = 0; n < births && drops.length < MAX_DROPS; n++) {
    spawnDrop(ctx);
  }

  // Advance and draw each drop. pos increases as the drop sweeps through
  // strip indices (rim→apex in ring mode, around the dome in rib mode).
  const tailStrips = 2.8; // how many strips long a drop's tail is
  for (let d = drops.length - 1; d >= 0; d--) {
    drops[d].pos += drops[d].speed * ctx.dt;
    if (drops[d].pos > stripCount + tailStrips) {
      drops.splice(d, 1);
      continue;
    }
  }

  for (let d = 0; d < drops.length; d++) {
    const drop = drops[d];

    // Draw head and tail: for each strip within tailStrips of drop.pos, light
    // the nearest LED to drop.lon with fade proportional to distance behind
    // the head.
    const lowR = Math.max(0, Math.floor(drop.pos - tailStrips));
    const highR = Math.min(stripCount - 1, Math.ceil(drop.pos));
    for (let r = lowR; r <= highR; r++) {
      const dist = drop.pos - r; // >0 means drop has passed this strip (tail)
      if (dist < 0 || dist > tailStrips) continue;
      // Head is brightest at dist ~ 0, tail fades as dist grows.
      const fade = 1 - dist / tailStrips;
      const v = drop.bright * fade * fade;
      const size = strips[r].ledCount;
      if (size === 0) continue;
      const idx = Math.floor((drop.lon / (Math.PI * 2)) * size) % size;
      // strip.startIndex locates the strip in the flat LED list.
      const i = strips[r].startIndex + ((idx + size) % size);
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
