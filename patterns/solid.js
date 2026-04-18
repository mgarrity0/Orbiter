// solid.js — paint every LED the same color.
//
// Edit the r/g/b values below, save the file, and the dome should update
// without a reload. This is the smoke test for hot-reload.

export const meta = {
  name: 'solid',
  description: 'every LED the same color',
};

export function render(ctx, out) {
  const r = 255;
  const g = 120;
  const b = 30;
  const n = ctx.ledCount;
  for (let i = 0; i < n; i++) {
    out[i * 3 + 0] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
}
