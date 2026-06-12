// Project save/load. A project file captures the user's whole editing
// state so closing + reopening Orbiter lands them exactly where they
// were: dome geometry, color pipeline, controller topology, motion
// config, feature flags, and the name of the last-loaded pattern.
//
// We deliberately do NOT serialize the pattern's source — patterns live
// on disk under {project-root}/patterns/ and are identified by filename.
// That way project files stay small and round-trip cleanly across
// machines that share a patterns/ folder.
//
// Format version is bumped when the schema changes in a way that older
// clients can't read. Keep migration code in loadProject().

import type { Structure } from './structure';
import { CHIPSETS, defaultRib } from './structure';
import { COLOR_ORDERS, type ColorConfig } from './colorSpace';
import type { Topology } from './topology';
import type { MotionConfig } from './motion';

export const PROJECT_FORMAT_VERSION = 1;

export type FeatureFlagsSnapshot = {
  bloom: boolean;
  hdr: boolean;
};

export type ProjectFile = {
  formatVersion: number;
  name: string;
  savedAt: string; // ISO-8601
  structure: Structure;
  colorConfig: ColorConfig;
  topology: Topology;
  motionConfig: MotionConfig;
  featureFlags: FeatureFlagsSnapshot;
  activePatternName: string | null;
};

export type ProjectSnapshot = Omit<ProjectFile, 'formatVersion' | 'savedAt'>;

export function buildProjectFile(snap: ProjectSnapshot): ProjectFile {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name: snap.name,
    savedAt: new Date().toISOString(),
    structure: snap.structure,
    colorConfig: snap.colorConfig,
    topology: snap.topology,
    motionConfig: snap.motionConfig,
    featureFlags: snap.featureFlags,
    activePatternName: snap.activePatternName,
  };
}

// ---------- Validation helpers -----------------------------------------
//
// These aren't exhaustive — they catch the shape errors that would crash
// the render loop or produce NaN geometry. Anything not covered here will
// still produce a usable state or a surface-level UI glitch, not a bomb.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function asFiniteNumber(obj: Record<string, unknown>, key: string, where: string): number {
  const v = obj[key];
  if (!isFiniteNumber(v)) throw new Error(`${where}.${key}: expected finite number`);
  return v;
}
function asBool(obj: Record<string, unknown>, key: string, where: string): boolean {
  const v = obj[key];
  if (typeof v !== 'boolean') throw new Error(`${where}.${key}: expected boolean`);
  return v;
}
function asString(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (typeof v !== 'string') throw new Error(`${where}.${key}: expected string`);
  return v;
}
function asObject(obj: Record<string, unknown>, key: string, where: string): Record<string, unknown> {
  const v = obj[key];
  if (!isObject(v)) throw new Error(`${where}.${key}: expected object`);
  return v;
}
function asArray(obj: Record<string, unknown>, key: string, where: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) throw new Error(`${where}.${key}: expected array`);
  return v;
}
// String fields with a closed set of values get checked against it — a
// merely-a-string check would let e.g. colorOrder: "RGBW" through to crash
// or corrupt an exporter much later, far from the bad data.
function asEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  where: string,
  allowed: readonly T[],
): T {
  const v = obj[key];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new Error(`${where}.${key}: expected one of ${allowed.join('/')}, got ${JSON.stringify(v)}`);
  }
  return v as T;
}

function validateStructure(raw: unknown): void {
  if (!isObject(raw)) throw new Error('structure: expected object');
  asFiniteNumber(raw, 'diameterMeters', 'structure');
  if ((raw.diameterMeters as number) <= 0) {
    throw new Error('structure.diameterMeters: must be > 0');
  }
  asFiniteNumber(raw, 'verticalRibCount', 'structure');
  // Integer, not just finite: the renderer and the LED builder both derive
  // longitude spacing from this — a fractional count would make them
  // disagree (builders truncate, drawing must match).
  if (!Number.isInteger(raw.verticalRibCount) || (raw.verticalRibCount as number) < 3) {
    throw new Error('structure.verticalRibCount: must be an integer >= 3');
  }
  const rings = asArray(raw, 'rings', 'structure');
  rings.forEach((r, i) => {
    if (!isObject(r)) throw new Error(`structure.rings[${i}]: expected object`);
    asString(r, 'id', `structure.rings[${i}]`);
    asFiniteNumber(r, 'latitudeDeg', `structure.rings[${i}]`);
    asFiniteNumber(r, 'ledCount', `structure.rings[${i}]`);
    if ((r.ledCount as number) < 1) {
      throw new Error(`structure.rings[${i}].ledCount: must be >= 1`);
    }
    asFiniteNumber(r, 'ledDensity', `structure.rings[${i}]`);
    asString(r, 'diffusion', `structure.rings[${i}]`);
  });

  // `layout` and `rib` were added after v1 shipped. Tolerate their absence
  // so older project files still load — the applyProjectFile step below
  // fills in defaults. When present they still get full validation.
  if (raw.layout !== undefined) {
    const layout = raw.layout;
    if (layout !== 'rings' && layout !== 'ribs') {
      throw new Error(`structure.layout: expected 'rings' or 'ribs', got ${JSON.stringify(layout)}`);
    }
  }
  if (raw.rib !== undefined) {
    const rib = asObject(raw, 'rib', 'structure');
    asFiniteNumber(rib, 'ledCount', 'structure.rib');
    if ((rib.ledCount as number) < 1) {
      throw new Error('structure.rib.ledCount: must be >= 1');
    }
    asFiniteNumber(rib, 'ledDensity', 'structure.rib');
    asFiniteNumber(rib, 'apexLatitudeDeg', 'structure.rib');
    // topLatitudeDeg arrived with the orb-extent feature; older files omit
    // it (backfilled below).
    if (rib.topLatitudeDeg !== undefined) {
      asFiniteNumber(rib, 'topLatitudeDeg', 'structure.rib');
    }
    asString(rib, 'diffusion', 'structure.rib');
    asEnum(rib, 'chipset', 'structure.rib', CHIPSETS);

    // wave + holes arrived with the channel/dot model; older files omit
    // them (backfilled below). Validate fully when present.
    if (rib.wave !== undefined) {
      const wave = asObject(rib, 'wave', 'structure.rib');
      asFiniteNumber(wave, 'amplitudeMeters', 'structure.rib.wave');
      asFiniteNumber(wave, 'cycles', 'structure.rib.wave');
    }
    if (rib.holes !== undefined) {
      const holes = asObject(rib, 'holes', 'structure.rib');
      asFiniteNumber(holes, 'count', 'structure.rib.holes');
      if ((holes.count as number) < 0) {
        throw new Error('structure.rib.holes.count: must be >= 0');
      }
      asFiniteNumber(holes, 'offsetMeters', 'structure.rib.holes');
      asEnum(holes, 'chipset', 'structure.rib.holes', CHIPSETS);
    }
  }
  if (raw.frameApexLatitudeDeg !== undefined) {
    asFiniteNumber(raw, 'frameApexLatitudeDeg', 'structure');
  }
  if (raw.frameTopLatitudeDeg !== undefined) {
    asFiniteNumber(raw, 'frameTopLatitudeDeg', 'structure');
  }
}

function validateColorConfig(raw: unknown): void {
  if (!isObject(raw)) throw new Error('colorConfig: expected object');
  asFiniteNumber(raw, 'gamma', 'colorConfig');
  asFiniteNumber(raw, 'brightness', 'colorConfig');
  asEnum(raw, 'colorOrder', 'colorConfig', COLOR_ORDERS);
  const trim = asObject(raw, 'trim', 'colorConfig');
  asFiniteNumber(trim, 'r', 'colorConfig.trim');
  asFiniteNumber(trim, 'g', 'colorConfig.trim');
  asFiniteNumber(trim, 'b', 'colorConfig.trim');
}

function validateTopology(raw: unknown): void {
  if (!isObject(raw)) throw new Error('topology: expected object');
  const ctrls = asArray(raw, 'controllers', 'topology');
  ctrls.forEach((c, i) => {
    if (!isObject(c)) throw new Error(`topology.controllers[${i}]: expected object`);
    asString(c, 'id', `topology.controllers[${i}]`);
    asString(c, 'name', `topology.controllers[${i}]`);
    asString(c, 'kind', `topology.controllers[${i}]`);
    asString(c, 'host', `topology.controllers[${i}]`);
    const outs = asArray(c, 'outputs', `topology.controllers[${i}]`);
    outs.forEach((o, j) => {
      const where = `topology.controllers[${i}].outputs[${j}]`;
      if (!isObject(o)) throw new Error(`${where}: expected object`);
      asString(o, 'id', where);
      asFiniteNumber(o, 'pin', where);
      asFiniteNumber(o, 'ledStart', where);
      asFiniteNumber(o, 'ledCount', where);
      asString(o, 'label', where);
      // chipset arrived with the channel/dot model; older files omit it
      // (backfilled in parseProjectFile).
      if (o.chipset !== undefined) asEnum(o, 'chipset', where, CHIPSETS);
    });
  });
}

function validateMotionConfig(raw: unknown): void {
  if (!isObject(raw)) throw new Error('motionConfig: expected object');
  asString(raw, 'source', 'motionConfig');
  const rocking = asObject(raw, 'rocking', 'motionConfig');
  asFiniteNumber(rocking, 'amplitudeDeg', 'motionConfig.rocking');
  asFiniteNumber(rocking, 'frequencyHz', 'motionConfig.rocking');
  asString(rocking, 'axis', 'motionConfig.rocking');
}

function validateFeatureFlags(raw: unknown): void {
  if (!isObject(raw)) throw new Error('featureFlags: expected object');
  asBool(raw, 'bloom', 'featureFlags');
  asBool(raw, 'hdr', 'featureFlags');
}

// Accepts a raw object parsed from disk, validates it, and returns a
// narrowed ProjectFile. Throws with a human-readable message on any
// shape or type mismatch; UI should surface it. Intentionally strict:
// malformed nested fields would otherwise crash the render loop or
// produce NaN geometry later.
export function parseProjectFile(raw: unknown): ProjectFile {
  if (!isObject(raw)) {
    throw new Error('Project file is not an object');
  }
  const version = raw.formatVersion;
  if (!isFiniteNumber(version)) {
    throw new Error('Missing or invalid formatVersion');
  }
  if (version > PROJECT_FORMAT_VERSION) {
    throw new Error(
      `Project was saved with a newer Orbiter (format v${version}); this build supports v${PROJECT_FORMAT_VERSION}`,
    );
  }
  asString(raw, 'name', 'project');
  asString(raw, 'savedAt', 'project');

  validateStructure(raw.structure);
  validateColorConfig(raw.colorConfig);
  validateTopology(raw.topology);
  validateMotionConfig(raw.motionConfig);
  validateFeatureFlags(raw.featureFlags);

  // activePatternName may be null or a string.
  const apn = raw.activePatternName;
  if (apn !== null && typeof apn !== 'string') {
    throw new Error('activePatternName: expected string or null');
  }

  // Back-fill fields added after v1 shipped, preserving the file's original
  // appearance — never inject new visual features into an old save:
  //   - `layout`/`rib`: files predating the vertical layout were ring mode.
  //   - `rib.wave`/`rib.holes`: files predating the channel/dot model get a
  //     straight channel and no hole LEDs (NOT the new defaults, which would
  //     change their LED count and positions).
  //   - `frameApexLatitudeDeg`: the old drawn-frame extent was a fixed 85°.
  //   - output `chipset`: everything exported before the field existed was
  //     WS2815, the only chipset the app supported then.
  const structure = raw.structure as Record<string, unknown>;
  if (structure.layout === undefined) structure.layout = 'rings';
  if (structure.rib === undefined) {
    structure.rib = defaultRib(structure.diameterMeters as number);
  }
  const rib = structure.rib as Record<string, unknown>;
  if (rib.wave === undefined) rib.wave = { amplitudeMeters: 0, cycles: 0 };
  if (rib.holes === undefined) {
    rib.holes = { count: 0, offsetMeters: 0.14, chipset: 'WS2811' };
  }
  // Strips and frame stopped at the equator before the orb-extent feature.
  if (rib.topLatitudeDeg === undefined) rib.topLatitudeDeg = 0;
  if (structure.frameApexLatitudeDeg === undefined) {
    structure.frameApexLatitudeDeg = 85;
  }
  if (structure.frameTopLatitudeDeg === undefined) {
    structure.frameTopLatitudeDeg = 0;
  }
  const topology = raw.topology as Record<string, unknown>;
  for (const c of topology.controllers as Array<Record<string, unknown>>) {
    for (const o of c.outputs as Array<Record<string, unknown>>) {
      if (o.chipset === undefined) o.chipset = 'WS2815';
    }
  }

  return raw as unknown as ProjectFile;
}
