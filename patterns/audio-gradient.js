// audio-gradient.js — altitude gradient whose colors are steered by audio
// bands.
//
// The gradient runs along TRUE altitude (led.lat — correct in both layouts
// and unaffected by the hole-dot strips): bass colors the bottom of the orb,
// mids the belly, highs the crown. A rolling hue drift keeps it moving even
// in a still mix, and the hole dots shimmer a touch brighter than the strip
// LEDs so they read as sparkle on top of the wash.

export const meta = {
  name: 'audio-gradient',
  description: 'altitude gradient with hue driven by audio bands',
};

let hueDrift = 0;
// Latitude extents, measured in setup so the gradient always spans exactly
// the built structure (orb top to bottom apex). cachedCount lets render()
// self-heal if it's ever reached without a fresh setup.
let minLat = 0;
let maxLat = 1;
let cachedCount = -1;

export function setup(ctx) {
  hueDrift = 0;
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

  // Drift the global hue forward a little every frame, faster when there's
  // more energy. This gives a sense of motion even in a still mix.
  hueDrift = (hueDrift + ctx.dt * (0.03 + ctx.audio.energy * 0.4)) % 1;

  const latSpan = maxLat - minLat;

  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    // tAlt: 0 at the orb's crown (lowest lat), 1 at the bottom apex.
    const tAlt = Math.max(0, Math.min(1, (led.lat - minLat) / latSpan));
    // Longitude in [0, 1].
    const tLon = ((led.lon / (Math.PI * 2)) + 1) % 1;

    // Three hue anchors along altitude, shifted by each audio band:
    // bass owns the bottom, mids the belly, highs the crown.
    const hueBottom = (hueDrift + 0.95 + ctx.audio.low * 0.1) % 1;
    const hueMid = (hueDrift + 0.30 + ctx.audio.mid * 0.15) % 1;
    const hueCrown = (hueDrift + 0.65 + ctx.audio.high * 0.15) % 1;

    // Blend along altitude via two lerps (crown->mid, mid->bottom).
    let hue;
    if (tAlt < 0.5) {
      hue = hueCrown + (hueMid - hueCrown) * (tAlt * 2);
    } else {
      hue = hueMid + (hueBottom - hueMid) * ((tAlt - 0.5) * 2);
    }
    // Add a gentle longitudinal drift so it doesn't look like stripes.
    hue = (hue + tLon * 0.06) % 1;
    if (hue < 0) hue += 1;

    // Brightness: dominated by mid+high, with low giving a slow breath.
    // Dots get a shimmer boost so they sparkle above the wash.
    let bright = 0.25 + ctx.audio.mid * 0.5 + ctx.audio.high * 0.4 + ctx.audio.low * 0.2;
    if (led.kind === 'points') {
      bright *= 1.15 + 0.25 * Math.sin(ctx.time * 2.7 + led.i * 1.7);
    }
    const v = Math.min(1, bright);

    // ctx.hsv writes HSV-as-RGB into `out` without allocating per LED.
    ctx.hsv(out, i * 3, hue, 0.85, v);
  }
}
