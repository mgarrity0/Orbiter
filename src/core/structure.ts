// Structure data model and per-LED derivation.
//
// Coordinate convention (matches Three.js default): +Y is up. The dome hangs
// below the xz-plane with its open rim at y=0 and its apex pointing down to
// y=-r. An LED at latitude `lat` radians and longitude `lon` radians sits at:
//   x =  r * cos(lat) * cos(lon)
//   y = -r * sin(lat)
//   z = -r * cos(lat) * sin(lon)
// where r = diameter/2.  lat = 0 is the equator (the widest ring);
// lat = π/2 is the (closed) apex at the bottom, and NEGATIVE latitudes
// rise above the equator toward the top pole at +r — that's how the
// structure closes into an orb like the physical build, whose ribs
// converge at the top.
//
// Two LED layout modes:
//   - 'rings': LEDs wrap horizontally around the dome at fixed latitudes.
//     Each Ring is a separate strip of varying length.
//   - 'ribs' (default — matches the physical build): each plywood rib has a
//     wavy channel routed into its face that holds an LED strip, plus a row
//     of drilled holes alongside the channel that each carry one point LED.
//     The rib lies in a meridian plane, so both the channel's wave and the
//     hole offsets displace LEDs *radially* (in the board's plane) — exactly
//     how the CNC cut waves across the board face.
//
// In both modes the per-LED `ring` field is "strip index" and `ringSize` is
// "LEDs on that strip" — patterns that already use these fields to drive
// per-strip behavior keep working in either layout, just with a different
// spatial meaning. In rib mode, strips 0..ribCount-1 are the channel strips
// and (when holes are configured) strips ribCount..2*ribCount-1 are the
// per-rib hole-LED strips. Patterns that want a true altitude axis should
// read `led.lat` (always correct regardless of layout).

export type Diffusion = 'bare' | 'frosted' | 'acrylic-band';
export type Chipset = 'WS2815' | 'WS2812B' | 'WS2811';
export const CHIPSETS: Chipset[] = ['WS2815', 'WS2812B', 'WS2811'];
export type LedDensity = 30 | 60;

export type Ring = {
  id: string;
  latitudeDeg: number;
  ledCount: number;
  ledDensity: LedDensity;
  diffusion: Diffusion;
  chipset: Chipset;
};

// The wavy channel routed into each rib's face. Every rib is cut from the
// same CNC template, so there is no per-rib phase — the wave is identical
// on all ribs, like the physical build. amplitudeMeters = 0 degenerates to
// a straight meridian channel.
export type RibWave = {
  amplitudeMeters: number; // radial swing of the channel (± from centerline)
  cycles: number;          // full sine periods across the strip's length
};

// Drilled holes alongside the channel, one point LED each. Holes alternate
// sides of the channel (radially in/out) so they read as a scatter rather
// than a second parallel strip. count = 0 disables them.
export type RibHoles = {
  count: number;
  offsetMeters: number; // radial distance from the channel path
  chipset: Chipset;     // typically discrete pixels, not strip stock
};

// Ribs are identical (one CNC template) so they share a single config
// object rather than a per-rib list. The strip spans latitudes
// `topLatitudeDeg` → `apexLatitudeDeg`: the apex end is how close to the
// bottom apex the channel terminates, and the top end is how far it climbs
// — 0 stops at the equator, negative values rise above it toward the top
// pole, closing the orb like the physical build.
export type RibConfig = {
  ledCount: number;
  ledDensity: LedDensity;
  topLatitudeDeg: number;
  apexLatitudeDeg: number;
  diffusion: Diffusion;
  chipset: Chipset;
  wave: RibWave;
  holes: RibHoles;
};

export type LedLayout = 'rings' | 'ribs';

export type Structure = {
  diameterMeters: number;
  shape: 'open-top-half-dome';
  verticalRibCount: number;
  // Latitude span of the structural plywood ribs as drawn: how far toward
  // the bottom apex they extend, and how far they climb above the equator
  // (negative top = toward the top pole, where the build's ribs converge).
  // This is frame geometry, deliberately independent of the LED layout —
  // switching between ring and rib LED configs doesn't change the frame.
  frameApexLatitudeDeg: number;
  frameTopLatitudeDeg: number;
  layout: LedLayout;
  rings: Ring[];
  rib: RibConfig;
};

// Per-LED record. `i` is the absolute index into the flat LED list (the one
// patterns write into via `out[i*3+0..2]`). `lat`/`lon` are the parametric
// position on the dome (the channel wave only displaces x/y/z, not lat/lon,
// so patterns keep a clean coordinate space).
export type Led = {
  i: number;
  ring: number;
  index: number;
  lat: number;
  lon: number;
  x: number;
  y: number;
  z: number;
  ringSize: number;
};

export type StripKind = 'channel' | 'points';

// Derived per-strip metadata exposed to patterns and to the renderer's halo
// lookup. Always correct for the active layout, so callers don't have to
// branch on `structure.layout` themselves. `startIndex` is the strip's
// first LED in the flat list — the LED list is exactly the strips
// concatenated in order, and this field is the one place that invariant is
// encoded (patterns must not re-derive offsets by summing ledCounts).
export type Strip = {
  startIndex: number;
  ledCount: number;
  kind: StripKind;
  diffusion: Diffusion;
  chipset: Chipset;
};

const DEG = Math.PI / 180;

export function ringCircumferenceMeters(diameterMeters: number, latitudeDeg: number): number {
  return Math.PI * diameterMeters * Math.cos(latitudeDeg * DEG);
}

export function suggestedLedCount(
  diameterMeters: number,
  latitudeDeg: number,
  density: LedDensity,
): number {
  return Math.max(1, Math.round(ringCircumferenceMeters(diameterMeters, latitudeDeg) * density));
}

// ---------- rib channel geometry ----------------------------------------

// Radial displacement of the routed channel at parameter t (0 = top end of
// the strip, 1 = channel end at apexLatitudeDeg).
function channelWaveMeters(rib: RibConfig, t: number): number {
  const { amplitudeMeters, cycles } = rib.wave;
  if (amplitudeMeters <= 0 || cycles <= 0) return 0;
  return amplitudeMeters * Math.sin(t * cycles * Math.PI * 2);
}

// Latitude at parameter t along the strip, guarded so the span stays
// strictly positive even if a project file claims top >= apex (builders
// divide by the span; a degenerate config should render squashed, not
// NaN out).
function ribLatAt(rib: RibConfig, t: number): number {
  const apexDeg = rib.apexLatitudeDeg;
  const topDeg = Math.min(rib.topLatitudeDeg, apexDeg - 1);
  return (topDeg + t * (apexDeg - topDeg)) * DEG;
}

function spherePoint(
  radiusMeters: number,
  lat: number,
  cosLon: number,
  sinLon: number,
): [number, number, number] {
  const rr = radiusMeters * Math.cos(lat);
  return [rr * cosLon, -radiusMeters * Math.sin(lat), -rr * sinLon];
}

// Point on a rib's routed channel at parameter t in [0,1] (t=0 at the
// strip's top end, t=1 at the apex end). The wave displaces the point
// radially, which keeps it in the rib's meridian plane (on the board
// face) — the squiggle you see on the physical ribs.
export function ribChannelPoint(
  diameterMeters: number,
  rib: RibConfig,
  ribIndex: number,
  ribCount: number,
  t: number,
): [number, number, number] {
  const lon = (ribIndex / ribCount) * Math.PI * 2;
  const lat = ribLatAt(rib, t);
  const rEff = diameterMeters / 2 + channelWaveMeters(rib, t);
  return spherePoint(rEff, lat, Math.cos(lon), Math.sin(lon));
}

// Polyline of one rib's channel — what the renderer draws as the routed
// groove. The default segment count scales with the wave (16 points per
// cycle, floor 96) so a high-cycle squiggle never aliases into straight
// chords; pass `segments` only to override that.
export function ribChannelSegments(rib: RibConfig): number {
  return Math.max(96, Math.ceil(rib.wave.cycles * 16));
}

export function ribChannelPolyline(
  diameterMeters: number,
  rib: RibConfig,
  ribIndex: number,
  ribCount: number,
  segments = ribChannelSegments(rib),
): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let s = 0; s <= segments; s++) {
    pts.push(ribChannelPoint(diameterMeters, rib, ribIndex, ribCount, s / segments));
  }
  return pts;
}

// Arc length of the wavy channel, integrated numerically — the wave makes
// the channel meaningfully longer than the plain meridian arc (a default
// dome's channel is ~15-25% longer), so LED-count suggestions must measure
// the actual path, not the great-circle arc.
export function ribChannelArcLengthMeters(diameterMeters: number, rib: RibConfig): number {
  const pts = ribChannelPolyline(diameterMeters, rib, 0, 1);
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const dz = pts[i][2] - pts[i - 1][2];
    len += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return len;
}

export function suggestedRibLedCount(diameterMeters: number, rib: RibConfig): number {
  return Math.max(1, Math.round(ribChannelArcLengthMeters(diameterMeters, rib) * rib.ledDensity));
}

// ---------- defaults -----------------------------------------------------

export function defaultRings(diameterMeters: number, density: LedDensity = 60): Ring[] {
  // Evenly-ish distributed between equator and near the apex, skipping the
  // collapsed point at 90°.
  const latitudes = [0, 22.5, 45, 67.5, 80];
  return latitudes.map((latitudeDeg, i) => ({
    id: `ring-${i}`,
    latitudeDeg,
    ledCount: suggestedLedCount(diameterMeters, latitudeDeg, density),
    ledDensity: density,
    diffusion: 'bare' as const,
    chipset: 'WS2815' as const,
  }));
}

export function defaultRib(diameterMeters: number, density: LedDensity = 60): RibConfig {
  const rib: RibConfig = {
    ledCount: 1, // placeholder — replaced below once the span/wave is known
    ledDensity: density,
    // The strip climbs well above the equator like the build's ribs, which
    // converge near the top pole.
    topLatitudeDeg: -65,
    apexLatitudeDeg: 85,
    diffusion: 'bare',
    chipset: 'WS2815',
    // Sized to read clearly at the default 4.88m dome: ±9cm of swing over
    // 10 periods approximates the build's routed channel across the longer
    // top-to-apex span.
    wave: { amplitudeMeters: 0.09, cycles: 10 },
    holes: { count: 18, offsetMeters: 0.14, chipset: 'WS2811' },
  };
  rib.ledCount = suggestedRibLedCount(diameterMeters, rib);
  return rib;
}

export function defaultStructure(): Structure {
  const diameterMeters = 4.88; // 16 ft
  return {
    diameterMeters,
    shape: 'open-top-half-dome',
    verticalRibCount: 16,
    frameApexLatitudeDeg: 85,
    frameTopLatitudeDeg: -65,
    // Rib layout is the default — it's what the physical build is.
    layout: 'ribs',
    rings: defaultRings(diameterMeters, 60),
    rib: defaultRib(diameterMeters, 60),
  };
}

// ---------- derived strips + LEDs ----------------------------------------

// Build the per-strip list — always correct for the active layout, in flat
// LED-list order. In ring mode this mirrors structure.rings. In rib mode
// it's the channel strips (one per rib) followed by the per-rib hole-LED
// strips when holes are configured.
export function buildStrips(s: Structure): Strip[] {
  const out: Strip[] = [];
  let startIndex = 0;
  const push = (ledCount: number, kind: StripKind, diffusion: Diffusion, chipset: Chipset) => {
    out.push({ startIndex, ledCount, kind, diffusion, chipset });
    startIndex += ledCount;
  };

  if (s.layout === 'ribs') {
    const count = Math.max(1, s.verticalRibCount | 0);
    const channelLeds = Math.max(1, s.rib.ledCount | 0);
    for (let i = 0; i < count; i++) {
      push(channelLeds, 'channel', s.rib.diffusion, s.rib.chipset);
    }
    const holeCount = Math.max(0, s.rib.holes.count | 0);
    if (holeCount > 0) {
      for (let i = 0; i < count; i++) {
        push(holeCount, 'points', 'bare', s.rib.holes.chipset);
      }
    }
    return out;
  }

  for (const r of s.rings) {
    push(Math.max(1, r.ledCount | 0), 'channel', r.diffusion, r.chipset);
  }
  return out;
}

export function buildLeds(s: Structure): Led[] {
  if (s.layout === 'ribs') return buildRibLeds(s);
  return buildRingLeds(s);
}

function buildRingLeds(s: Structure): Led[] {
  const radius = s.diameterMeters / 2;
  const out: Led[] = [];
  let absoluteIndex = 0;
  for (let r = 0; r < s.rings.length; r++) {
    const ring = s.rings[r];
    const lat = ring.latitudeDeg * DEG;
    const ringRadius = radius * Math.cos(lat);
    const y = -radius * Math.sin(lat);
    const count = Math.max(1, ring.ledCount | 0);
    for (let i = 0; i < count; i++) {
      const lon = (i / count) * Math.PI * 2;
      out.push({
        i: absoluteIndex++,
        ring: r,
        index: i,
        lat,
        lon,
        x: ringRadius * Math.cos(lon),
        y,
        z: -ringRadius * Math.sin(lon),
        ringSize: count,
      });
    }
  }
  return out;
}

// Rib-mode LED order matches buildStrips: every rib's channel strip first,
// then every rib's hole LEDs. Channel LEDs follow the wavy channel path;
// hole LEDs sit offset from it, alternating sides.
function buildRibLeds(s: Structure): Led[] {
  const radius = s.diameterMeters / 2;
  const ribCount = Math.max(1, s.verticalRibCount | 0);
  const ledsPerRib = Math.max(1, s.rib.ledCount | 0);
  const out: Led[] = [];
  let absoluteIndex = 0;

  for (let rib = 0; rib < ribCount; rib++) {
    const lon = (rib / ribCount) * Math.PI * 2;
    const cosLon = Math.cos(lon);
    const sinLon = Math.sin(lon);
    for (let i = 0; i < ledsPerRib; i++) {
      // LED 0 sits at the strip's top end (topLatitudeDeg); the last LED
      // sits at the apex end. When ledsPerRib === 1 we collapse to the
      // top end to avoid 0/0.
      const t = ledsPerRib > 1 ? i / (ledsPerRib - 1) : 0;
      const lat = ribLatAt(s.rib, t);
      const rEff = radius + channelWaveMeters(s.rib, t);
      const [x, y, z] = spherePoint(rEff, lat, cosLon, sinLon);
      out.push({
        i: absoluteIndex++,
        ring: rib,
        index: i,
        lat,
        lon,
        x,
        y,
        z,
        ringSize: ledsPerRib,
      });
    }
  }

  const holeCount = Math.max(0, s.rib.holes.count | 0);
  if (holeCount > 0) {
    for (let rib = 0; rib < ribCount; rib++) {
      const lon = (rib / ribCount) * Math.PI * 2;
      const cosLon = Math.cos(lon);
      const sinLon = Math.sin(lon);
      for (let j = 0; j < holeCount; j++) {
        // Holes sit between channel wave extremes, centered in each 1/count
        // band, alternating radially in/out of the channel path.
        const t = (j + 0.5) / holeCount;
        const lat = ribLatAt(s.rib, t);
        const side = j % 2 === 0 ? 1 : -1;
        const rEff = radius + channelWaveMeters(s.rib, t) + side * s.rib.holes.offsetMeters;
        const [x, y, z] = spherePoint(rEff, lat, cosLon, sinLon);
        out.push({
          i: absoluteIndex++,
          ring: ribCount + rib,
          index: j,
          lat,
          lon,
          x,
          y,
          z,
          ringSize: holeCount,
        });
      }
    }
  }
  return out;
}

export function totalLedCount(s: Structure): number {
  if (s.layout === 'ribs') {
    const ribCount = Math.max(1, s.verticalRibCount | 0);
    const perRib =
      Math.max(1, s.rib.ledCount | 0) + Math.max(0, s.rib.holes.count | 0);
    return ribCount * perRib;
  }
  let n = 0;
  for (const ring of s.rings) n += Math.max(1, ring.ledCount | 0);
  return n;
}

// Structural rib centerline: the plywood board itself is a smooth meridian
// arc (only the routed channel waves). Returns `segments+1` points for the
// given rib, spanning topLatitudeDeg → apexLatitudeDeg. Callers pass the
// structure's frame extents.
export function ribMeridianPoints(
  diameterMeters: number,
  ribIndex: number,
  ribCount: number,
  segments = 32,
  apexLatitudeDeg = 85,
  topLatitudeDeg = 0,
): Array<[number, number, number]> {
  const r = diameterMeters / 2;
  const lon = (ribIndex / ribCount) * Math.PI * 2;
  const cosLon = Math.cos(lon);
  const sinLon = Math.sin(lon);
  const topLat = Math.min(topLatitudeDeg, apexLatitudeDeg - 1) * DEG;
  const apexLat = apexLatitudeDeg * DEG;
  const pts: Array<[number, number, number]> = [];
  for (let s = 0; s <= segments; s++) {
    const lat = topLat + (s / segments) * (apexLat - topLat);
    pts.push(spherePoint(r, lat, cosLon, sinLon));
  }
  return pts;
}

// Returns a closed ring polyline (last point != first; renderer should close).
export function ringPolyline(
  diameterMeters: number,
  latitudeDeg: number,
  segments = 128,
): Array<[number, number, number]> {
  const r = diameterMeters / 2;
  const lat = latitudeDeg * DEG;
  const ringR = r * Math.cos(lat);
  const y = -r * Math.sin(lat);
  const pts: Array<[number, number, number]> = [];
  for (let s = 0; s < segments; s++) {
    const lon = (s / segments) * Math.PI * 2;
    pts.push([ringR * Math.cos(lon), y, -ringR * Math.sin(lon)]);
  }
  return pts;
}
