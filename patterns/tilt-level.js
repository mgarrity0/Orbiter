// tilt-level.js — a stack of horizontal world-space bands ("contour lines of
// gravity"). Each band sits at a fixed world-y and keeps its height in
// world space as the dome rocks around its apex, so the entire stack stays
// level while the dome tilts through it.
//
// World-space math: the dome pivots around its apex at world (0, -r, 0).
// A dome-local point (x, y, z) with y ∈ [-r, 0] transforms to world as:
//     world = R * (x, y+r, z) + (0, -r, 0)
// where R = R_Z(roll) * R_X(pitch) (Three.js Euler 'XYZ', yaw=0).

export const meta = {
  name: 'tilt-level',
  description: 'stacked horizontal world-space bands — stays level under rocking',
};

const SPACING = 0.40;     // meters between adjacent band centers
const BAND_HALF = 0.09;   // meters — thickness of each lit band
const BAND_COLORS = [
  [255, 60, 60],    // red — lowest band
  [255, 180, 40],   // orange
  [80, 240, 120],   // green
  [60, 200, 255],   // cyan
  [200, 90, 255],   // violet — highest band
];

export function render(ctx, out) {
  const { pitch, roll } = ctx.motion;
  const r = ctx.structure.diameterMeters / 2;

  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);

  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    // Apex-pivot world-y for this LED.
    const yLocal = led.y + r;
    const yRot = led.x * sr + yLocal * cr * cp - led.z * cr * sp;
    const worldY = yRot - r;

    // Snap to the nearest band center and measure distance to it.
    const bandIdx = Math.round(worldY / SPACING);
    const center = bandIdx * SPACING;
    const d = Math.abs(worldY - center) / BAND_HALF;
    const glow = Math.max(0, 1 - d);
    const brightness = glow * glow;

    // Pick a color for this band index, wrapping through the palette so
    // adjacent bands never share a color.
    const colorIdx =
      ((bandIdx % BAND_COLORS.length) + BAND_COLORS.length) % BAND_COLORS.length;
    const color = BAND_COLORS[colorIdx];

    out[i * 3 + 0] = color[0] * brightness;
    out[i * 3 + 1] = color[1] * brightness;
    out[i * 3 + 2] = color[2] * brightness;
  }
}
