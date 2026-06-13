// tilt-level.js — sloshing liquid. A virtual body of water fills the lower
// part of the orb and stays level in WORLD space while the structure rocks,
// so the waterline sweeps dramatically across the tilting ribs. The surface
// is alive: it lags the tilt, overshoots, and rings down like real liquid
// (a damped slosh oscillator), with ripples that get choppy when the rocking
// is hard and glassy when it's still. Below the line the water shades darker
// with depth and shimmers with caustics; at the line a bright meniscus glows;
// the hole dots act as bubbles underwater and as spray near a violent
// waterline.
//
// World-space math: the orb pivots around its apex at world (0, -r, 0). A
// dome-local point (x, y, z) transforms to world as
//   world = R * (x, y + r, z) + (0, -r, 0)
// with R = Rx(pitch) * Ry(yaw) * Rz(roll) (Three.js Euler 'XYZ'). Only the
// y-row of R is needed to know how deep an LED sits.

export const meta = {
  name: 'tilt-level',
  description: 'sloshing liquid that stays level while the orb rocks',
};

// --- liquid tuning ---------------------------------------------------------
const FILL = 0.42;        // resting fill: fraction of the orb's height
const BREATHE = 0.035;    // slow fill breathing, fraction of height
const MENISCUS_FRAC = 0.045; // half-thickness of the waterline glow, fraction of radius
const SLOSH_FREQ = 1.1;   // Hz — natural frequency of the slosh oscillator
const SLOSH_DAMP = 2.0;   // 1/s — how fast slosh rings down
const SLOSH_KICK = 1.6;   // how hard tilt velocity pumps the slosh
const SLOSH_MAX = 0.22;   // radians — cap so violent drags can't fold the surface
const RIPPLE_WAVES = 6;   // spatial ripple count across one orb radius
const SPRAY_REACH_FRAC = 0.25; // how far above the line spray fires, fraction of radius

// Dome-local y extents, measured in setup so any structure works.
let minY = 0;
let maxY = 1;
// Per-LED dot flags + a random phase per LED for bubble/spray twinkle.
let isDot = null;
let phase = null;
// Slosh oscillator: a small deviation plane (sx tips the surface around the
// x-axis, sz around z) that spring-returns to level but is kicked by tilt
// velocity. Semi-implicit Euler keeps it stable at any frame rate.
let sx = 0, sz = 0, vsx = 0, vsz = 0;

export function setup(ctx) {
  minY = Infinity;
  maxY = -Infinity;
  for (let i = 0; i < ctx.leds.length; i++) {
    const y = ctx.leds[i].y;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!(maxY > minY)) {
    minY = -1;
    maxY = 1;
  }
  isDot = new Uint8Array(ctx.ledCount);
  phase = new Float32Array(ctx.ledCount);
  for (let i = 0; i < ctx.ledCount; i++) {
    isDot[i] = ctx.leds[i].kind === 'points' ? 1 : 0;
    const h = Math.sin(i * 78.233) * 43758.5453;
    phase[i] = (h - Math.floor(h)) * Math.PI * 2;
  }
  sx = sz = vsx = vsz = 0;
}

export function render(ctx, out) {
  if (!isDot || isDot.length !== ctx.ledCount) setup(ctx);

  const { pitch, roll, yaw, pitchVel, rollVel } = ctx.motion;
  const r = ctx.structure.diameterMeters / 2;
  const t = ctx.time;
  const dt = Math.min(0.05, ctx.dt);

  // y-row of R = Rx(pitch) * Ry(yaw) * Rz(roll).
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sr = Math.sin(roll), cr = Math.cos(roll);
  const m10 = cp * sr + sp * sy * cr;
  const m11 = cp * cr - sp * sy * sr;
  const m12 = -sp * cy;

  // Advance the slosh oscillator. Tilt velocity is the pump; the spring
  // pulls the surface back to level and the damping rings it down.
  const k = (SLOSH_FREQ * Math.PI * 2) ** 2;
  vsx += (-k * sx - SLOSH_DAMP * vsx + SLOSH_KICK * pitchVel) * dt;
  vsz += (-k * sz - SLOSH_DAMP * vsz + SLOSH_KICK * rollVel) * dt;
  sx = Math.max(-SLOSH_MAX, Math.min(SLOSH_MAX, sx + vsx * dt));
  sz = Math.max(-SLOSH_MAX, Math.min(SLOSH_MAX, sz + vsz * dt));

  // 0 = glassy pond, 1 = full storm. Drives ripples, meniscus heat, spray.
  const energy = Math.min(1, Math.hypot(sx, sz) * 5 + Math.hypot(vsx, vsz) * 0.6);

  const height = maxY - minY;
  const waterY = minY + (FILL + Math.sin(t * 0.23) * BREATHE) * height;
  // All liquid thicknesses scale with the orb so the look holds at any size.
  const meniscus = MENISCUS_FRAC * r;
  const sprayReach = SPRAY_REACH_FRAC * r;
  const rippleAmp = (0.006 + energy * 0.033) * r;
  const deepRange = Math.max(0.3, height * 0.6);

  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    const yL = led.y + r;
    const worldY = m10 * led.x + m11 * yL + m12 * led.z - r;

    // Liquid surface height over this LED's spot: the slosh deviation plane
    // plus two traveling ripple trains. Local x/z stand in for world
    // horizontal — at rocking angles the difference is invisible.
    const surf =
      waterY +
      sx * led.z -
      sz * led.x +
      rippleAmp *
        0.5 *
        (Math.sin((led.x / r) * RIPPLE_WAVES + t * 3.1) +
          Math.sin((led.z / r) * RIPPLE_WAVES * 0.83 - t * 2.4));

    const depth = surf - worldY; // > 0 means submerged

    // Meniscus: a hot cyan-white line right at the waterline, brighter when
    // the water is angry. `meniscus` is the band thickness; `mGlow` the glow.
    const mg = Math.max(0, 1 - Math.abs(depth) / meniscus);
    const mGlow = mg * mg * (0.55 + 0.45 * energy);
    let rOut = mGlow * (140 + 80 * energy);
    let gOut = mGlow * 235;
    let bOut = mGlow * 255;

    if (depth > 0) {
      // Underwater: teal fading to deep blue with depth, with slow-moving
      // caustic shimmer.
      const dn = Math.min(1, depth / deepRange);
      const caustic =
        0.8 + 0.2 * Math.sin((led.x / r) * 7 + (led.z / r) * 6 + t * 1.9 + (depth / r) * 9);
      const fade = (1 - dn * 0.8) * caustic;
      rOut += 10 * fade;
      gOut += (95 - 60 * dn) * fade;
      bOut += (175 - 80 * dn) * fade;

      if (isDot[i]) {
        // Bubbles: dots underwater pulse softly out of phase with each other.
        const tw = 0.55 + 0.45 * Math.sin(t * 2.1 + phase[i]);
        rOut += 30 * tw;
        gOut += 120 * tw;
        bOut += 160 * tw;
      }
    } else {
      // Above the surface: near-dark cool air so the orb still reads.
      rOut += 2;
      gOut += 4;
      bOut += 8;

      // Spray: dots just above an energetic waterline flash white.
      if (isDot[i] && depth > -sprayReach) {
        const s = Math.sin(t * 9 + phase[i] * 3);
        const spray = energy * Math.max(0, s) ** 8;
        rOut += 220 * spray;
        gOut += 240 * spray;
        bOut += 255 * spray;
      }
    }

    out[i * 3 + 0] = rOut;
    out[i * 3 + 1] = gOut;
    out[i * 3 + 2] = bOut;
  }
}
