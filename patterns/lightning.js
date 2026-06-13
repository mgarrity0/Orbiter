// lightning.js — lightning strikes carve crooked forks across the orb.
//
// In rib mode a bolt strikes the crown and crawls DOWN one rib's channel,
// jittering sideways to neighboring ribs and occasionally forking — and
// every cell it strikes can flash the nearest hole dot on that rib, so the
// dots spark like embers along the bolt's path. In ring mode the bolt
// descends through the rings at a wandering longitude, the classic fork.
// A brief ambient flash brightens the whole orb the instant a bolt fires.

export const meta = {
  name: 'lightning',
  description: 'crooked lightning forks crawl down the orb',
};

let levels = null; // per-LED cool-white intensity, decays each frame
let flash = 0;     // ambient orb flash from recent strike
let nextStrikeAt = 0;

// Strike one cell of a rib-mode bolt: the LED itself, a neighbor above and
// below for thickness, and (sometimes) the rib's nearest hole dot.
function strikeRibCell(strips, nChan, rib, idx, v) {
  const s = strips[rib];
  const size = s.ledCount;
  if (size === 0) return;
  const k = Math.max(0, Math.min(size - 1, idx));
  for (let d = -1; d <= 1; d++) {
    const kk = k + d;
    if (kk < 0 || kk >= size) continue;
    const led = s.startIndex + kk;
    const lv = d === 0 ? v : v * 0.5;
    if (levels[led] < lv) levels[led] = lv;
  }
  const dots = strips[nChan + rib];
  if (dots && dots.kind === 'points' && Math.random() < 0.4) {
    // Map by latitude parameter, not raw strip fraction: channel LEDs run
    // t = k/(size-1) while dots sit at t = (j+0.5)/holeCount, so the nearest
    // dot to a struck cell is round(t*holeCount - 0.5) — otherwise the spark
    // drifts a band off near the crown/apex where the mappings diverge most.
    const tCell = size > 1 ? k / (size - 1) : 0;
    const j = Math.max(0, Math.min(dots.ledCount - 1, Math.round(tCell * dots.ledCount - 0.5)));
    const led = dots.startIndex + j;
    if (levels[led] < 0.9) levels[led] = 0.9;
  }
}

// Crawl from the crown toward the apex, wandering across ribs. `rib` wraps
// around the orb. Returns nothing — it writes into `levels`.
function walkRibBolt(strips, nChan, startRib, startIdx, v) {
  const size = strips[startRib].ledCount;
  const stride = Math.max(1, Math.round(size / 44));
  let rib = startRib;
  for (let idx = startIdx; idx < size; idx += stride) {
    strikeRibCell(strips, nChan, rib, idx, v);
    // Lateral jitter: hop to a neighboring rib now and then.
    if (Math.random() < 0.3) {
      rib = (rib + (Math.random() < 0.5 ? 1 : nChan - 1)) % nChan;
    }
    // Rare fork: a dimmer branch splits off and walks the rest on its own.
    if (Math.random() < 0.05 && v > 0.6) {
      const forkRib = (rib + (Math.random() < 0.5 ? 1 : nChan - 1)) % nChan;
      walkRibBolt(strips, nChan, forkRib, idx + stride, v * 0.7);
      // The main bolt sometimes dies where it forked.
      if (Math.random() < 0.3) return;
    }
  }
}

function spawnBolt(ctx) {
  const strips = ctx.strips;
  let nChan = 0;
  for (let s = 0; s < strips.length; s++) {
    if (strips[s].kind !== 'points') nChan++;
  }
  if (nChan === 0) return;

  if (ctx.structure.layout === 'ribs') {
    walkRibBolt(strips, nChan, (Math.random() * nChan) | 0, 0, 1.0);
    flash = 0.6;
    return;
  }

  // Ring mode: descend through the rings at a wandering longitude.
  let lon = Math.random() * Math.PI * 2;
  for (let r = 0; r < nChan; r++) {
    const s = strips[r];
    const size = s.ledCount;
    if (size === 0) continue;
    const idx = Math.floor((lon / (Math.PI * 2)) * size) % size;

    // Core of the bolt + 1 LED on either side for some thickness.
    for (let d = -1; d <= 1; d++) {
      const k = s.startIndex + (((idx + d) % size) + size) % size;
      const v = d === 0 ? 1.0 : 0.5;
      if (levels[k] < v) levels[k] = v;
    }

    // Rare forks: light up a second branch at a larger offset.
    if (r > 0 && Math.random() < 0.2) {
      const forkOffset = Math.floor(size * (0.04 + Math.random() * 0.06));
      const sign = Math.random() < 0.5 ? 1 : -1;
      const k = s.startIndex + (((idx + sign * forkOffset) % size) + size) % size;
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
