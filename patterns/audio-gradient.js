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

let hueDrift = 0;

export function setup() {
  hueDrift = 0;
}

export function render(ctx, out) {
  // Drift the global hue forward a little every frame, faster when there's
  // more energy. This gives a sense of motion even in a still mix.
  hueDrift = (hueDrift + ctx.dt * (0.03 + ctx.audio.energy * 0.4)) % 1;

  // `strips` works for both layouts. In rib mode "strip index" is a
  // longitude bin, so the gradient sweeps around the dome rather than top-
  // to-bottom — still painterly, just rotated.
  const stripCount = Math.max(1, ctx.strips.length);

  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    // tRing in [0, 1] along the strip index axis.
    const tRing = led.ring / Math.max(1, stripCount - 1);
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

    // ctx.hsv writes HSV-as-RGB into `out` without allocating per LED.
    ctx.hsv(out, i * 3, hue, 0.85, v);
  }
}
