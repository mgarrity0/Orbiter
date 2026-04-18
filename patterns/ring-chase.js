// ring-chase.js — a bright dot runs around each ring, one ring per color.
//
// Demonstrates: per-LED lookup via ctx.leds, time-based animation, per-ring
// state. Each ring's dot advances at the same angular rate so larger rings
// sweep more LEDs per second.

export const meta = {
  name: 'ring-chase',
  description: 'a colored dot chases around each ring',
};

const RING_COLORS = [
  [255, 60, 40],
  [255, 200, 20],
  [40, 255, 120],
  [40, 180, 255],
  [200, 80, 255],
  [255, 60, 180],
];

export function render(ctx, out) {
  // Dot position = angular rate * time, wrapped to [0, 2pi).
  const TWO_PI = Math.PI * 2;
  const anglePerSec = TWO_PI * 0.4; // one lap every 2.5s
  const headAngle = (anglePerSec * ctx.time) % TWO_PI;

  const tailLen = 0.35; // radians — how long the fading tail is

  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    const color = RING_COLORS[led.ring % RING_COLORS.length];
    // Distance from this LED to the head, going "behind" the head so the
    // tail fades out trailing it. Wrapped into [0, 2pi).
    const d = (((headAngle - led.lon) % TWO_PI) + TWO_PI) % TWO_PI;

    let brightness = 0;
    if (d < tailLen) {
      brightness = 1 - d / tailLen;
    }
    out[i * 3 + 0] = color[0] * brightness;
    out[i * 3 + 1] = color[1] * brightness;
    out[i * 3 + 2] = color[2] * brightness;
  }
}
