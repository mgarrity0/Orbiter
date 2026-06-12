// audio-bars.js — polar spectrum analyzer. Each LED's position around its
// ring maps to an FFT frequency bin; brightness = that bin's magnitude.
// Ring index maps to color (warm at the bottom, cool toward the apex).
//
// Start the mic in the Audio panel to see anything. With no mic input,
// ctx.audio.bins is all zeros and the dome stays dark.

export const meta = {
  name: 'audio-bars',
  description: 'polar FFT spectrum around each ring',
};

export function render(ctx, out) {
  const bins = ctx.audio.bins;
  const n = bins.length;
  const usableBins = Math.floor(n * 0.7); // drop noisy high-end

  // `strips` works in both layouts; `led.ring` is strip index either way.
  const stripCount = Math.max(1, ctx.strips.length);

  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    // Position within this strip -> FFT bin index.
    const binIdx = Math.floor((led.index / led.ringSize) * usableBins);
    const v = bins[binIdx];

    // Color gradient by strip: lower indices warm red/orange, higher cool.
    const tRing = led.ring / Math.max(1, stripCount - 1);
    const r = (1 - tRing) * 255 + tRing * 30;
    const g = (1 - tRing) * 80 + tRing * 120;
    const b = (1 - tRing) * 30 + tRing * 255;

    // Punch up the contrast — raise to a power > 1 so quiet bins stay dark.
    const brightness = v * v;

    out[i * 3 + 0] = r * brightness;
    out[i * 3 + 1] = g * brightness;
    out[i * 3 + 2] = b * brightness;
  }
}
