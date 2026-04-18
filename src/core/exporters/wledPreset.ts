// WLED preset JSON exporter.
//
// Each WLED controller on the network is its own device with LED indices
// starting at 0. This exporter produces one JSON file per WLED controller
// in the topology; each file is a preset payload you can POST to
// `http://<host>/json/state` or paste into the Presets editor.
//
// Each controller's outputs become WLED "segments" with controller-local
// start/stop (WLED doesn't know about the global LED address space we use
// for rendering — that only matters for the baked exporter in wledBaked.ts).
//
// We emit an `on` / `bri` / `seg` payload that mirrors what WLED writes
// when you ask it to save a preset from the live state. Readers of WLED
// source: this maps to `deserializeState` in WLED/src/json.cpp.

import type { Topology, Controller, ControllerOutput } from '../topology';
import type { ColorConfig } from '../colorSpace';

export type WledPresetFile = {
  // Suggested filename, e.g. "wled-1-preset.json".
  filename: string;
  // The controller this preset targets. Blank host gets "" — user can still
  // upload the file manually.
  host: string;
  // Pretty-printed JSON.
  json: string;
};

export type WledSegment = {
  id: number;
  start: number;
  stop: number;    // exclusive, per WLED convention
  len: number;
  grp: 1;
  spc: 0;
  of: 0;
  on: true;
  frz: false;
  bri: number;     // segment brightness (0..255)
  col: [[number, number, number], [number, number, number], [number, number, number]];
  fx: 0;           // Solid — actual effects are set per-preset after deploy
  sx: 128;
  ix: 128;
  pal: 0;
  sel: true;
  rev: false;
  mi: false;
  n?: string;      // optional name
};

export type WledPresetPayload = {
  on: true;
  bri: number;
  transition: 7;
  mainseg: 0;
  seg: WledSegment[];
};

// Serialize one controller's outputs into a WLED preset payload. Segment
// indices run 0..N-1 over the controller's outputs (WLED caps at 32).
export function buildWledPresetForController(
  ctrl: Controller,
  cfg: ColorConfig,
): WledPresetPayload {
  const bri = Math.round(Math.max(0, Math.min(1, cfg.brightness)) * 255);
  // WLED local indexing: segment starts at 0 for the first output on that
  // controller, then advances by each output's ledCount. We are not using
  // the global `ledStart` here — that is only the simulator's slice into
  // the global LED list. On-device, the first pixel on pin X is pixel 0.
  let localStart = 0;
  const seg: WledSegment[] = ctrl.outputs.map((o: ControllerOutput, i: number) => {
    const start = localStart;
    const stop = localStart + o.ledCount;
    localStart = stop;
    return {
      id: i,
      start,
      stop,
      len: o.ledCount,
      grp: 1,
      spc: 0,
      of: 0,
      on: true,
      frz: false,
      bri: 255, // master `bri` is the brightness knob; segment `bri` stays at 255
      col: [[255, 160, 40], [0, 0, 0], [0, 0, 0]],
      fx: 0,
      sx: 128,
      ix: 128,
      pal: 0,
      sel: true,
      rev: false,
      mi: false,
      n: o.label,
    };
  });
  return {
    on: true,
    bri,
    transition: 7,
    mainseg: 0,
    seg,
  };
}

// Returns one file per WLED controller in the topology. FastLED controllers
// are skipped (they have their own exporter). Throws if no WLED controllers
// exist — the caller should have disabled the button.
export function buildWledPresetBundle(
  topology: Topology,
  cfg: ColorConfig,
): WledPresetFile[] {
  const wled = topology.controllers.filter((c) => c.kind === 'WLED');
  if (wled.length === 0) {
    throw new Error('No WLED controllers in topology.');
  }
  return wled.map((c) => {
    const payload = buildWledPresetForController(c, cfg);
    const safeName = c.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
      filename: `${safeName}-preset.json`,
      host: c.host,
      json: JSON.stringify(payload, null, 2),
    };
  });
}
