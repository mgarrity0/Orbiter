// rainstorm.js — raindrops streak down the orb.
//
// In rib mode each drop falls down ONE rib's channel strip — from the
// orb's crown to the bottom apex — leaving a fading blue-white tail and
// splashing that rib's hole dots white as it passes them. In ring mode
// drops sweep through the rings at a fixed longitude (rim → apex), the
// classic behavior. `strip.startIndex` locates strips in the flat LED
// list; only channel strips carry drops.

export const meta = {
  name: 'rainstorm',
  description: 'raindrops streak down the orb, splashing the dots',
};

const MAX_DROPS = 80;
let drops = [];

export function setup() {
  drops = [];
}

export function render(ctx, out) {
  const strips = ctx.strips;
  // Channel strips lead the strip list in both layouts; dots (if any)
  // follow, one per rib, in rib order.
  let nChan = 0;
  for (let s = 0; s < strips.length; s++) {
    if (strips[s].kind !== 'points') nChan++;
  }
  if (nChan === 0) return;
  const ribMode = ctx.structure.layout === 'ribs';

  // Ambient dark-teal wash, very dim.
  for (let i = 0; i < ctx.ledCount; i++) {
    out[i * 3 + 0] = 3;
    out[i * 3 + 1] = 10;
    out[i * 3 + 2] = 22;
  }

  // Spawn new drops. Rate scales with strip count to keep density roughly
  // consistent across orb sizes (rib drops live longer, so fewer per sec).
  const ratePerSec = Math.max(8, nChan * (ribMode ? 1.5 : 4));
  const births = Math.floor(ratePerSec * ctx.dt + Math.random());
  for (let n = 0; n < births && drops.length < MAX_DROPS; n++) {
    drops.push({
      strip: (Math.random() * nChan) | 0,
      lon: Math.random() * Math.PI * 2, // ring mode only
      // Rib mode: pos is t along the strip (0 = crown end, 1 = apex).
      // Ring mode: pos is a strip index that sweeps rim -> apex.
      pos: ribMode ? -0.05 : -0.5,
      speed: ribMode
        ? 1 / (0.7 + Math.random() * 0.7) // cross the rib in ~0.7-1.4s
        : nChan / (0.9 + Math.random() * 0.7),
      bright: 0.7 + Math.random() * 0.3,
    });
  }

  if (ribMode) {
    const tailT = 0.16; // tail length, in strip-t units
    for (let d = drops.length - 1; d >= 0; d--) {
      const drop = drops[d];
      drop.pos += drop.speed * ctx.dt;
      if (drop.pos > 1 + tailT) {
        drops.splice(d, 1);
        continue;
      }
      const s = strips[drop.strip];
      const size = s.ledCount;
      if (size === 0) continue;

      // Head + fading tail above it.
      const headIdx = drop.pos * (size - 1);
      const tailLeds = Math.max(2, Math.ceil(tailT * size));
      const hi = Math.min(size - 1, Math.floor(headIdx));
      const lo = Math.max(0, hi - tailLeds);
      for (let k = lo; k <= hi; k++) {
        const dist = (headIdx - k) / tailLeds; // 0 at head, 1 at tail end
        if (dist < 0 || dist > 1) continue;
        const fade = 1 - dist;
        const v = drop.bright * fade * fade;
        const i = s.startIndex + k;
        // Head is cool white-blue, tail is deeper teal.
        const r8 = 30 * v * fade;
        const g8 = (90 + 80 * fade) * v;
        const b8 = (200 + 55 * fade) * v;
        if (out[i * 3 + 0] < r8) out[i * 3 + 0] = r8;
        if (out[i * 3 + 1] < g8) out[i * 3 + 1] = g8;
        if (out[i * 3 + 2] < b8) out[i * 3 + 2] = b8;
      }

      // Splash this rib's dots white as the head passes their altitude. The
      // window is half the dot spacing, so each dot peaks as the head crosses
      // its center and is dark at the band edges — a flash that travels with
      // the drop, not a dot that's just always on while the drop is in range.
      const dotsStrip = strips[nChan + drop.strip];
      if (dotsStrip && dotsStrip.kind === 'points' && drop.pos >= 0 && drop.pos <= 1) {
        const dc = dotsStrip.ledCount;
        const j = Math.min(dc - 1, Math.floor(drop.pos * dc));
        const dotT = (j + 0.5) / dc;
        const window = 0.5 / dc;
        const prox = 1 - Math.min(1, Math.abs(drop.pos - dotT) / window);
        if (prox > 0) {
          const i = dotsStrip.startIndex + j;
          const v = drop.bright * prox;
          if (out[i * 3 + 0] < 180 * v) out[i * 3 + 0] = 180 * v;
          if (out[i * 3 + 1] < 220 * v) out[i * 3 + 1] = 220 * v;
          if (out[i * 3 + 2] < 255 * v) out[i * 3 + 2] = 255 * v;
        }
      }
    }
    return;
  }

  // --- Ring mode: drops sweep through strip indices at a fixed longitude.
  const tailStrips = 2.8; // how many strips long a drop's tail is
  for (let d = drops.length - 1; d >= 0; d--) {
    drops[d].pos += drops[d].speed * ctx.dt;
    if (drops[d].pos > nChan + tailStrips) {
      drops.splice(d, 1);
    }
  }

  for (let d = 0; d < drops.length; d++) {
    const drop = drops[d];
    const lowR = Math.max(0, Math.floor(drop.pos - tailStrips));
    const highR = Math.min(nChan - 1, Math.ceil(drop.pos));
    for (let r = lowR; r <= highR; r++) {
      const dist = drop.pos - r; // >0 means drop has passed this strip (tail)
      if (dist < 0 || dist > tailStrips) continue;
      const fade = 1 - dist / tailStrips;
      const v = drop.bright * fade * fade;
      const size = strips[r].ledCount;
      if (size === 0) continue;
      const idx = Math.floor((drop.lon / (Math.PI * 2)) * size) % size;
      const i = strips[r].startIndex + ((idx + size) % size);
      const r8 = 30 * v * fade;
      const g8 = (90 + 80 * fade) * v;
      const b8 = (200 + 55 * fade) * v;
      if (out[i * 3 + 0] < r8) out[i * 3 + 0] = r8;
      if (out[i * 3 + 1] < g8) out[i * 3 + 1] = g8;
      if (out[i * 3 + 2] < b8) out[i * 3 + 2] = b8;
    }
  }
}
