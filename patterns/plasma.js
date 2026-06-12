// plasma.js — smooth animated color field in lat/lon space.
//
// Classic plasma: sum of a few sine waves at different frequencies and
// directions, color-mapped through a palette. Uses led.lat and led.lon so
// the pattern lives on the dome surface, not in screen space.

export const meta = {
  name: 'plasma',
  description: 'lat/lon plasma field',
};

export function render(ctx, out) {
  const t = ctx.time;
  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    const a = Math.sin(led.lon * 3 + t * 0.8);
    const b = Math.sin(led.lat * 6 - t * 0.5);
    const c = Math.sin((led.lon + led.lat) * 2 + t * 0.3);
    const v = (a + b + c) / 3; // [-1, 1]
    const hue = (v * 0.5 + 0.5 + t * 0.02) % 1;
    // ctx.hsv writes HSV-as-RGB into `out` without allocating per LED.
    ctx.hsv(out, i * 3, hue, 1, 1);
  }
}
