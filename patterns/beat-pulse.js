// beat-pulse.js — beat-reactive altitude pulse. Kick-drum hits launch a
// wave at the bottom apex that rolls up the orb to the crown.
//
// Waves travel along TRUE altitude (led.lat), so the motion is identical in
// ring and rib layouts and the hole-dot strips ride the same wavefront as
// the channel LEDs (with a little extra flare, so each passing wave leaves
// a trail of sparks). We track the bass band (audio.low) and look for
// onsets — moments where the current level spikes above a slowly-tracked
// baseline. Between hits the orb holds a dim ambient wash so it still
// breathes when the track is quiet.

export const meta = {
  name: 'beat-pulse',
  description: 'bass-reactive waves roll from the apex up to the crown',
};

// Rolling baseline for bass so the onset detector adapts to volume.
let baseline = 0;
// Active waves. `pos` is the wavefront's altitude in [0, 1]: 1 = bottom
// apex (where waves are born), 0 = crown. It decreases as the wave climbs.
const waves = [];
const MAX_WAVES = 6;
const WAVE_WIDTH = 0.14; // altitude units — wavefront thickness
const CLIMB_TIME = 0.6;  // seconds for a wave to cross the whole orb

// Latitude extents, measured in setup (orb crown → bottom apex). cachedCount
// lets render() self-heal if it's ever reached without a fresh setup.
let minLat = 0;
let maxLat = 1;
let cachedCount = -1;

export function setup(ctx) {
  baseline = 0;
  waves.length = 0;
  minLat = Infinity;
  maxLat = -Infinity;
  for (let i = 0; i < ctx.leds.length; i++) {
    const lat = ctx.leds[i].lat;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!(maxLat > minLat)) {
    minLat = 0;
    maxLat = 1;
  }
  cachedCount = ctx.ledCount;
}

export function render(ctx, out) {
  if (cachedCount !== ctx.ledCount) setup(ctx);

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
      // The onset detector already proved a kick happened, so every wave is
      // punchy (>= 0.7); how far `low` overshoots the threshold adds the
      // extra wallop for a hard hit. Raw `low` (~0.1-0.4) would make even a
      // clean kick a faint smudge.
      const strength = Math.min(1, 0.7 + Math.max(0, low - threshold) * 3);
      waves.push({ born: ctx.time, pos: 1 + WAVE_WIDTH, strength });
    }
  }

  // Advance each wave from the apex (1) toward the crown (0).
  const speed = 1 / CLIMB_TIME;
  for (let w = 0; w < waves.length; w++) {
    waves[w].pos -= speed * ctx.dt;
  }
  // Cull waves that have rolled off the crown.
  while (waves.length > 0 && waves[0].pos < -WAVE_WIDTH * 2) waves.shift();

  // Ambient wash brightness tied to mid+high energy so the orb always moves.
  const ambient = 0.05 + ctx.audio.energy * 0.15;
  const latSpan = maxLat - minLat;

  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    const tAlt = Math.max(0, Math.min(1, (led.lat - minLat) / latSpan));

    // Sum contributions from all active waves at this altitude.
    let pulse = 0;
    for (let w = 0; w < waves.length; w++) {
      const d = Math.abs(waves[w].pos - tAlt);
      if (d < WAVE_WIDTH) pulse += (1 - d / WAVE_WIDTH) * waves[w].strength;
    }
    pulse = Math.min(1.2, pulse);
    // Dots flare harder at the wavefront — sparks riding the wave.
    if (led.kind === 'points') pulse = Math.min(1.4, pulse * 1.5);

    // Color: warm orange core, fades to magenta at high pulse; ambient is
    // deep purple.
    const v = Math.min(1, pulse + ambient);
    out[i * 3 + 0] = (200 * pulse + 40 * ambient) * v;
    out[i * 3 + 1] = (60 * pulse + 10 * ambient) * v;
    out[i * 3 + 2] = (120 * pulse + 60 * ambient) * v;
  }
}
