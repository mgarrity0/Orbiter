// Structure data model and per-LED derivation.
//
// Coordinate convention (matches Three.js default): +Y is up. The dome hangs
// below the xz-plane with its open rim at y=0 and its apex pointing down to
// y=-r. An LED at latitude `lat` radians and longitude `lon` radians sits at:
//   x =  r * cos(lat) * cos(lon)
//   y = -r * sin(lat)
//   z = -r * cos(lat) * sin(lon)
// where r = diameter/2.  lat = 0 is the equator (widest ring, at the top);
// lat = π/2 is the (closed) apex at the bottom.

export type Diffusion = 'bare' | 'frosted' | 'acrylic-band';
export type Chipset = 'WS2815';
export type LedDensity = 30 | 60;

export type Ring = {
  id: string;
  latitudeDeg: number;
  ledCount: number;
  ledDensity: LedDensity;
  diffusion: Diffusion;
  chipset: Chipset;
};

export type Structure = {
  diameterMeters: number;
  shape: 'open-top-half-dome';
  verticalRibCount: number;
  rings: Ring[];
};

// Per-LED record. `i` is the absolute index into the flat LED list (the one
// patterns write into via `out[i*3+0..2]`).
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

export function defaultStructure(): Structure {
  const diameterMeters = 4.88; // 16 ft
  return {
    diameterMeters,
    shape: 'open-top-half-dome',
    verticalRibCount: 16,
    rings: defaultRings(diameterMeters, 60),
  };
}

export function buildLeds(s: Structure): Led[] {
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

export function totalLedCount(s: Structure): number {
  let n = 0;
  for (const ring of s.rings) n += Math.max(1, ring.ledCount | 0);
  return n;
}

// Rib geometry: a rib runs from the equator up along a meridian to near the
// apex. Returns a list of `segments+1` points in 3D space for the given rib.
export function ribMeridianPoints(
  diameterMeters: number,
  ribIndex: number,
  ribCount: number,
  segments = 32,
  apexLatitudeDeg = 85,
): Array<[number, number, number]> {
  const r = diameterMeters / 2;
  const lon = (ribIndex / ribCount) * Math.PI * 2;
  const cosLon = Math.cos(lon);
  const sinLon = Math.sin(lon);
  const topLat = apexLatitudeDeg * DEG;
  const pts: Array<[number, number, number]> = [];
  for (let s = 0; s <= segments; s++) {
    const lat = (s / segments) * topLat;
    const rr = r * Math.cos(lat);
    const y = -r * Math.sin(lat);
    pts.push([rr * cosLon, y, -rr * sinLon]);
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
