// beat-pulse.js — beat-reactive concentric pulse. Kick-drum hits ripple from
// apex to rim.
//
// Ring 0 is the rim (top); the last ring is near the apex (bottom). We
// track the bass band (audio.low) and look for onsets — moments where the
// current level spikes above a slowly-tracked baseline. Each onset spawns
// a wave that starts near the apex and sweeps outward to the rim. Between
// hits the dome holds a dim ambient wash so it still breathes when the
// track is quiet.

export const meta = {
  name: 'beat-pulse',
  description: 'bass-reactive waves ripple from apex to rim',
};

// Rolling baseline for bass so the onset detector adapts to volume.
let baseline = 0;
// Active waves. `pos` is the current ring index of the wave's leading edge.
// It starts at ringCount-1 (apex) and decreases toward 0 (rim).
const waves = [];
const MAX_WAVES = 6;

export function setup() {
  baseline = 0;
  waves.length = 0;
}

export function render(ctx, out) {
  const rings = ctx.structure.rings;
  const ringCount = rings.length;

  const low = ctx.audio.low;
  // Slow the baseline so transient spikes still stand out.
  baseline = baseline * 0.92 + low * 0.08;

  // Onset when current low is well above baseline + a floor (so silence
  // doesn't constantly fire).
  const threshold = baseline * 1.6 + 0.12;
  if (low > threshold && waves.length < MAX_WAVES) {
    // Throttle: don't spawn twice within the same frame or within 80ms.
    const last = waves[waves.length - 1];
    if (!last || ctx.time - last.born > 0.08) {
      waves.push({ born: ctx.time, pos: ringCount - 1 });
    }
  }

  // Advance each wave from apex (ringCount-1) toward rim (0) — ~0.6s total.
  const speed = ringCount / 0.6;
  for (let w = 0; w < waves.length; w++) {
    waves[w].pos -= speed * ctx.dt;
  }
  // Cull waves that have run past the rim.
  while (waves.length > 0 && waves[0].pos < -2) waves.shift();

  // Ambient wash brightness tied to mid+high energy so the dome always moves.
  const ambient = 0.05 + ctx.audio.energy * 0.15;

  // Walk rings, from apex (ring 0) outward. This matches structure.ts where
  // ring 0 is the smallest ring near the apex.
  let ledIdx = 0;
  for (let r = 0; r < ringCount; r++) {
    const size = rings[r].ledCount;

    // Sum contributions from all active waves.
    let pulse = 0;
    for (let w = 0; w < waves.length; w++) {
      const d = Math.abs(waves[w].pos - r);
      if (d < 1.2) pulse += 1 - d / 1.2;
    }
    pulse = Math.min(1.2, pulse);

    // Color: warm orange core, fades to magenta at high pulse; ambient is
    // deep purple.
    const v = Math.min(1, pulse + ambient);
    const r8 = (200 * pulse + 40 * ambient) * v;
    const g8 = (60 * pulse + 10 * ambient) * v;
    const b8 = (120 * pulse + 60 * ambient) * v;

    for (let k = 0; k < size; k++) {
      const i = ledIdx + k;
      out[i * 3 + 0] = r8;
      out[i * 3 + 1] = g8;
      out[i * 3 + 2] = b8;
    }
    ledIdx += size;
  }
}
