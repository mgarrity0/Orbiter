// audio-bars.js — spectrum analyzer painted along each strip. Each LED's
// position within its strip maps to an FFT frequency bin; brightness = that
// bin's magnitude. In rib mode every rib is a vertical analyzer column
// (lows at the strip's top end, highs at the apex); in ring mode the
// spectrum wraps around each ring. Color follows TRUE altitude (led.lat),
// warm at the bottom of the orb and cool at the crown, so the hole-dot
// strips don't skew the gradient.
//
// Start the mic in the Audio panel to see anything. With no mic input,
// ctx.audio.bins is all zeros and the dome stays dark.

export const meta = {
  name: 'audio-bars',
  description: 'per-strip FFT spectrum, colored by altitude',
};

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

  const bins = ctx.audio.bins;
  const n = bins.length;
  const usableBins = Math.floor(n * 0.7); // drop noisy high-end
  const latSpan = maxLat - minLat;

  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    // Position within this strip -> FFT bin index.
    const binIdx = Math.floor((led.index / led.ringSize) * usableBins);
    const v = bins[binIdx];

    // Color by altitude: warm at the bottom apex, cool at the crown.
    const tAlt = Math.max(0, Math.min(1, (led.lat - minLat) / latSpan));
    const r = tAlt * 255 + (1 - tAlt) * 30;
    const g = tAlt * 80 + (1 - tAlt) * 120;
    const b = tAlt * 30 + (1 - tAlt) * 255;

    // Punch up the contrast — raise to a power > 1 so quiet bins stay dark.
    // Dots flare a little harder so peaks read as sparks.
    const brightness = led.kind === 'points' ? Math.min(1, v * v * 1.5) : v * v;

    out[i * 3 + 0] = r * brightness;
    out[i * 3 + 1] = g * brightness;
    out[i * 3 + 2] = b * brightness;
  }
}
