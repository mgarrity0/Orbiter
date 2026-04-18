// plasma.js — smooth animated color field in lat/lon space.
//
// Classic plasma: sum of a few sine waves at different frequencies and
// directions, color-mapped through a palette. Uses led.lat and led.lon so
// the pattern lives on the dome surface, not in screen space.

export const meta = {
  name: 'plasma',
  description: 'lat/lon plasma field',
};

function hsvToRgb(h, s, v) {
  // h in [0,1]
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [r * 255, g * 255, b * 255];
}

export function render(ctx, out) {
  const t = ctx.time;
  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    const a = Math.sin(led.lon * 3 + t * 0.8);
    const b = Math.sin(led.lat * 6 - t * 0.5);
    const c = Math.sin((led.lon + led.lat) * 2 + t * 0.3);
    const v = (a + b + c) / 3; // [-1, 1]
    const hue = (v * 0.5 + 0.5 + t * 0.02) % 1;
    const [r, g, bl] = hsvToRgb(hue, 1, 1);
    out[i * 3 + 0] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = bl;
  }
}
