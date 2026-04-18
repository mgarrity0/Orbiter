// WLED "baked" animation exporter.
//
// Unlike wledPreset.ts (which emits a WLED preset describing segments and
// effects that WLED runs on-device), this exporter renders the active
// pattern in the simulator for a fixed duration and emits a
// frame-by-frame byte sequence per controller. A small companion player
// (outside WLED's native preset system) is expected to stream these bytes
// to the controller over e.g. UDP DRGB or WARLS.
//
// Why bake at all? Two reasons:
//   1. Complex audio/motion-reactive patterns can't run on WLED's built-in
//      effect engine — the ESP32 has no mic and doesn't see the phone's IMU.
//   2. Deterministic repeatability for an installation show: the baked JSON
//      is what you get, regardless of device CPU variance.
//
// The bytes in each frame have already been through the full WS2815
// pipeline (trim → color-order → brightness → gamma) — what's in the file
// is exactly what should go on the wire.

import type { Structure, Led } from '../structure';
import type { Topology, Controller } from '../topology';
import type { ColorConfig } from '../colorSpace';
import { bakeFrameToLinearFloats } from '../colorSpace';
import type { PatternModule, RenderContext, SetupContext } from '../patternApi';
import type { MotionState } from '../motion';
import type { AudioState } from '../audio';

export type BakeOptions = {
  fps: number;          // frames per second (typ. 30 or 60)
  durationSec: number;  // total baked length
  patternName: string;  // for embedding in metadata
};

export type WledBakedFile = {
  filename: string;
  host: string;
  json: string;
};

// Flat zero state for motion/audio — the baked exporter doesn't have a mic
// or accelerometer to sample from, so reactive patterns will render their
// "resting" output. If the user wants audio-reactive baked output, they
// should record a motion/audio trace and pass it in; left as a future
// extension.
function staticMotion(): MotionState {
  return { pitch: 0, roll: 0, yaw: 0, pitchVel: 0, rollVel: 0, yawVel: 0 };
}
function staticAudio(): AudioState {
  return {
    enabled: false,
    bins: new Float32Array(256),
    energy: 0,
    low: 0,
    mid: 0,
    high: 0,
  };
}

// Hex-encode a byte array without any separators. Output length = 2*bytes.
function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

// Walk a controller's outputs, pull the correct slice out of the global
// on-wire byte buffer, and concatenate in output order. The global buffer
// is already gamma-applied + color-reordered (it's what would go on the
// wire if the whole chain were one strip); per-controller we just need to
// pick the right ranges.
function controllerBytesForFrame(
  ctrl: Controller,
  wireBytes: Uint8Array,
): Uint8Array {
  let total = 0;
  for (const o of ctrl.outputs) total += o.ledCount * 3;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const o of ctrl.outputs) {
    const srcOff = o.ledStart * 3;
    const len = o.ledCount * 3;
    out.set(wireBytes.subarray(srcOff, srcOff + len), cursor);
    cursor += len;
  }
  return out;
}

// Bake N frames of `module` into a per-controller JSON bundle.
// Throws if the pattern's render throws (caller should surface to UI).
export function bakeTopology(
  module: PatternModule,
  structure: Structure,
  leds: Led[],
  topology: Topology,
  cfg: ColorConfig,
  opts: BakeOptions,
): WledBakedFile[] {
  const ledCount = leds.length;
  const totalFrames = Math.max(1, Math.round(opts.fps * opts.durationSec));
  const dt = 1 / opts.fps;

  // Give the module a chance to run setup.
  if (module.setup) {
    const setupCtx: SetupContext = { structure, leds, ledCount };
    module.setup(setupCtx);
  }

  // Per-controller accumulator for hex-encoded frame strings.
  const wledControllers = topology.controllers.filter((c) => c.kind === 'WLED');
  const framesByCtrl: Map<string, string[]> = new Map();
  for (const c of wledControllers) framesByCtrl.set(c.id, []);

  const rgbOut = new Uint8ClampedArray(ledCount * 3);
  const linearOut = new Float32Array(ledCount * 3);
  const wireBytes = new Uint8Array(ledCount * 3);

  const motion = staticMotion();
  const audio = staticAudio();

  for (let f = 0; f < totalFrames; f++) {
    const time = f * dt;
    rgbOut.fill(0);
    const ctx: RenderContext = {
      time,
      dt,
      frame: f,
      structure,
      leds,
      ledCount,
      motion,
      audio,
    };
    module.render(ctx, rgbOut);

    // Run the full color pipeline → linear floats in [0,1], then quantize
    // back to 0..255 bytes. Those bytes are what the wire sees (the LEDs'
    // on-device gamma LUT is NOT applied here — it will be in the FastLED
    // exporter, but for baked output we send post-gamma bytes directly).
    bakeFrameToLinearFloats(rgbOut, linearOut, cfg);
    for (let i = 0; i < linearOut.length; i++) {
      const v = linearOut[i];
      wireBytes[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }

    for (const c of wledControllers) {
      const ctrlBytes = controllerBytesForFrame(c, wireBytes);
      framesByCtrl.get(c.id)!.push(toHex(ctrlBytes));
    }
  }

  return wledControllers.map((c) => {
    const frames = framesByCtrl.get(c.id)!;
    const payload = {
      meta: {
        controllerName: c.name,
        host: c.host,
        patternName: opts.patternName,
        fps: opts.fps,
        totalFrames,
        durationSec: totalFrames / opts.fps,
        colorOrder: cfg.colorOrder,
        gamma: cfg.gamma,
        brightness: cfg.brightness,
      },
      outputs: c.outputs.map((o) => ({
        id: o.id,
        label: o.label,
        pin: o.pin,
        ledCount: o.ledCount,
      })),
      // Each frame: hex-encoded bytes, length = 2 * sum(output.ledCount) * 3.
      // Bytes within a frame are concatenated outputs in the order they
      // appear in the `outputs` array. Decoders should split by output
      // ledCount and push per-pin.
      frames,
    };
    const safeName = c.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
      filename: `${safeName}-baked.json`,
      host: c.host,
      json: JSON.stringify(payload),
    };
  });
}
