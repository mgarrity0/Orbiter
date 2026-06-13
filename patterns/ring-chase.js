// ring-chase.js — a rainbow beam spirals around the orb.
//
// The beam is a bright head with a fading tail that sweeps in longitude,
// twisted into a helix by altitude: each LED's chase phase is its longitude
// plus a twist proportional to its height, so in rib mode the beam corkscrews
// up the orb and in ring mode the per-ring heads trail each other into the
// same spiral. Hue runs along altitude and slowly rotates; the hole dots pop
// a little brighter as the beam passes them.

export const meta = {
  name: 'ring-chase',
  description: 'a rainbow beam spirals around the orb',
};

const TWO_PI = Math.PI * 2;
const TWIST = 2.4;    // radians of longitude twist across the full height
const TAIL = 0.9;     // radians — how long the fading tail is

// Latitude extents, measured in setup (orb crown → bottom apex). cachedCount
// lets render() self-heal if it's ever reached without a fresh setup.
let minLat = 0;
let maxLat = 1;
let cachedCount = -1;

export function setup(ctx) {
  minLat = Infinity;
  maxLat = -Infinity;
  for (let i = 0; i < ctx.leds.length; i++) {
    const lat = ctx.leds[i].lat;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!(maxLat > minLat)) {
    minLat = 0;
    maxLat = 1;
  }
  cachedCount = ctx.ledCount;
}

export function render(ctx, out) {
  if (cachedCount !== ctx.ledCount) setup(ctx);

  const anglePerSec = TWO_PI * 0.4; // one lap every 2.5s
  const headAngle = (anglePerSec * ctx.time) % TWO_PI;
  const latSpan = maxLat - minLat;

  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    const tAlt = Math.max(0, Math.min(1, (led.lat - minLat) / latSpan));

    // Helix: the chase phase advances with altitude, so the head traces a
    // corkscrew instead of a flat sweep.
    const phase = led.lon + tAlt * TWIST;
    // Distance behind the head, wrapped into [0, 2pi).
    const d = (((headAngle - phase) % TWO_PI) + TWO_PI) % TWO_PI;

    let brightness = d < TAIL ? 1 - d / TAIL : 0;
    if (brightness === 0) {
      out[i * 3 + 0] = 0;
      out[i * 3 + 1] = 0;
      out[i * 3 + 2] = 0;
      continue;
    }
    brightness *= brightness;
    if (led.kind === 'points') brightness = Math.min(1, brightness * 1.4);

    // Hue runs along altitude and slowly rotates over time.
    const hue = (0.62 + tAlt * 0.45 + ctx.time * 0.03) % 1;
    ctx.hsv(out, i * 3, hue, 0.9, brightness);
  }
}
