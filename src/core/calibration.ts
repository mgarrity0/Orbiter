// Calibration — swap synthetic sphere positions for captured real-world
// positions.
//
// Orbiter's default `buildLeds` places every pixel on an idealized
// hemisphere. Real installs are never that clean: LEDs drift along their
// strip, rings aren't perfectly circular, the frame deflects under load.
// Calibration lets you override the positions per-LED from a photo-based
// (or manual) capture.
//
// File format (import/export):
//   {
//     "formatVersion": 1,
//     "ledCount": 1536,
//     "units": "meters",
//     // `positions` is a flat array of 3*ledCount numbers in dome-local
//     // coordinates (same frame as structure.ts buildLeds: apex at
//     // y=-r, rim at y=0).
//     "positions": [x0, y0, z0, x1, y1, z1, ...]
//   }
//
// The expected LED count must match the current structure exactly; a
// calibration captured against a different structure (different diameter,
// different ring counts) won't apply and will be reported as a mismatch.

import type { Led } from './structure';

export const CALIBRATION_FORMAT_VERSION = 1;

export type CalibrationFile = {
  formatVersion: number;
  ledCount: number;
  units: 'meters';
  positions: number[];
};

export type CalibrationState = {
  enabled: boolean;
  // Flat Float32 of length ledCount*3. null when no capture is loaded.
  positions: Float32Array | null;
  sourceName: string | null;
  // Last error message from a failed import; cleared on a successful one.
  error: string | null;
};

export const defaultCalibration: CalibrationState = {
  enabled: false,
  positions: null,
  sourceName: null,
  error: null,
};

// Parse a JSON file's raw object into a CalibrationState positions buffer,
// or throw with a human-readable error.
export function parseCalibrationFile(raw: unknown, expectedLedCount: number): Float32Array {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Calibration file is not an object');
  }
  const obj = raw as Record<string, unknown>;
  const version = obj.formatVersion;
  if (typeof version !== 'number') throw new Error('Missing formatVersion');
  if (version > CALIBRATION_FORMAT_VERSION) {
    throw new Error(
      `Calibration was saved with a newer Orbiter (v${version}); this build supports v${CALIBRATION_FORMAT_VERSION}`,
    );
  }
  if (obj.units !== 'meters') {
    throw new Error(`Expected units: "meters", got ${JSON.stringify(obj.units)}`);
  }
  const positions = obj.positions;
  if (!Array.isArray(positions)) throw new Error('positions must be an array');
  if (positions.length !== expectedLedCount * 3) {
    throw new Error(
      `positions length mismatch: expected ${expectedLedCount * 3} (=${expectedLedCount}×3), got ${positions.length}`,
    );
  }
  const buf = new Float32Array(expectedLedCount * 3);
  for (let i = 0; i < positions.length; i++) {
    const v = positions[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`positions[${i}] is not a finite number`);
    }
    buf[i] = v;
  }
  return buf;
}

// Produce a calibration file object from the current LED list (useful as
// the starting point for manual refinement — export synthetic, edit, re-import).
export function exportCalibrationFromLeds(leds: Led[]): CalibrationFile {
  const positions: number[] = new Array(leds.length * 3);
  for (let i = 0; i < leds.length; i++) {
    positions[i * 3 + 0] = leds[i].x;
    positions[i * 3 + 1] = leds[i].y;
    positions[i * 3 + 2] = leds[i].z;
  }
  return {
    formatVersion: CALIBRATION_FORMAT_VERSION,
    ledCount: leds.length,
    units: 'meters',
    positions,
  };
}

// Produce a new LED list with x/y/z overridden from a captured positions
// buffer. If the buffer length doesn't match, returns the input unchanged
// — the caller should catch this in UI, but we don't want to throw from
// a hot store update path.
export function applyCalibration(leds: Led[], positions: Float32Array | null): Led[] {
  if (!positions || positions.length !== leds.length * 3) return leds;
  return leds.map((led, i) => ({
    ...led,
    x: positions[i * 3 + 0],
    y: positions[i * 3 + 1],
    z: positions[i * 3 + 2],
  }));
}
