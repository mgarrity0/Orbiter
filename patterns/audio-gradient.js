// audio-gradient.js — ring gradient whose colors are steered by audio bands.
//
// Each ring maps to a latitude band of the dome. We use the three audio
// summaries (low / mid / high) to drive a rolling hue offset plus a
// per-band brightness, then paint each ring as a smooth gradient from one
// hue to another around its circumference. The result is a slow, painterly
// light field that still reacts to music.

export const meta = {
  name: 'audio-gradient',
  description: 'latitude gradient with hue driven by audio bands',
};

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
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

let hueDrift = 0;

export function setup() {
  hueDrift = 0;
}

export function render(ctx, out) {
  // Drift the global hue forward a little every frame, faster when there's
  // more energy. This gives a sense of motion even in a still mix.
  hueDrift = (hueDrift + ctx.dt * (0.03 + ctx.audio.energy * 0.4)) % 1;

  const ringCount = Math.max(1, ctx.structure.rings.length);

  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    // tRing in [0, 1]: 0 at apex, 1 at rim (ring 0 is the smallest ring).
    const tRing = led.ring / Math.max(1, ringCount - 1);
    // Longitude in [0, 1].
    const tLon = ((led.lon / (Math.PI * 2)) + 1) % 1;

    // Three hue anchors across the band, shifted by each audio band.
    // - Low moves the apex hue toward red/orange.
    // - Mid moves the mid-band toward yellow/green.
    // - High moves the rim toward blue/magenta.
    const hueApex = (hueDrift + 0.95 + ctx.audio.low * 0.1) % 1;
    const hueMid  = (hueDrift + 0.30 + ctx.audio.mid * 0.15) % 1;
    const hueRim  = (hueDrift + 0.65 + ctx.audio.high * 0.15) % 1;

    // Blend across latitude via two lerps (apex->mid, mid->rim).
    let hue;
    if (tRing < 0.5) {
      hue = hueApex + (hueMid - hueApex) * (tRing * 2);
    } else {
      hue = hueMid + (hueRim - hueMid) * ((tRing - 0.5) * 2);
    }
    // Add a gentle longitudinal drift so it doesn't look like stripes.
    hue = (hue + tLon * 0.06) % 1;
    if (hue < 0) hue += 1;

    // Brightness: dominated by mid+high, with low giving a slow breath.
    const bright = 0.25 + ctx.audio.mid * 0.5 + ctx.audio.high * 0.4 + ctx.audio.low * 0.2;
    const v = Math.min(1, bright);

    const [r, g, b] = hsvToRgb(hue, 0.85, v);
    out[i * 3 + 0] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
}
