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
// The bytes in each frame have been through the sim's pipeline
// (trim → brightness → gamma) and are in authored RGB order — the device
// applies its own bus color order on output (meta.colorOrder records what
// the strip is wired as, so the player can verify the device config).
//
// The pattern module is STATEFUL and shared with the live preview — callers
// must pause the live render loop for the duration of the bake (the store's
// `baking` flag) and re-run setup() afterwards (`reloadActivePattern`), or
// live frames will interleave with baked ones and corrupt both.

import type { Structure, Led } from '../structure';
import { buildStrips } from '../structure';
import type { Topology, Controller } from '../topology';
import type { ColorConfig } from '../colorSpace';
import { bakeFrameToLinearFloats } from '../colorSpace';
import { writeHsv, type PatternModule, type RenderContext, type SetupContext } from '../patternApi';
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

// Precomputed byte → 2-char hex LUT. Avoids per-byte Number.toString(16)
// + string concatenation in the bake hot loop (which runs
// totalFrames * ledCount times — tens of thousands of calls for a normal
// bake). Building the output via an Array + .join is dramatically faster
// than repeated += on a growing string.
const HEX_LUT: string[] = (() => {
  const t = new Array<string>(256);
  for (let i = 0; i < 256; i++) t[i] = (i < 16 ? '0' : '') + i.toString(16);
  return t;
})();

function toHex(bytes: Uint8Array): string {
  const parts = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) parts[i] = HEX_LUT[bytes[i]];
  return parts.join('');
}

// Walk a controller's outputs, pull the correct slice out of the global
// byte buffer, and concatenate in output order. The global buffer is
// already gamma-applied, in authored RGB order (the device's bus config
// reorders on output); per-controller we just need to pick the right
// ranges.
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

export type BakeProgress = {
  framesDone: number;
  totalFrames: number;
};

// Hard ceiling on accumulated frame data. Every LED-frame is 6 hex chars
// and the final JSON.stringify temporarily doubles the footprint, so 96M
// chars keeps peak usage around ~200MB — far from V8's ~536M max string
// length, where an over-large bake would otherwise throw only AFTER
// rendering every frame. Checked up front instead.
const MAX_BAKE_CHARS = 96_000_000;

// The real footprint is per-controller: every WLED output's range is
// hex-encoded into its controller's frame list, so overlapping or
// duplicated ranges (a mirror install) count once per appearance — the
// estimate must sum output ledCounts, not use the global LED count.
function bakeChars(topology: Topology, totalFrames: number): number {
  let outputLeds = 0;
  for (const c of topology.controllers) {
    if (c.kind !== 'WLED') continue;
    for (const o of c.outputs) outputLeds += Math.max(0, o.ledCount);
  }
  return totalFrames * outputLeds * 6;
}

// Pre-flight size check, exported so the UI can reject an over-large bake
// before pausing the live preview or touching the pattern module. Returns
// a human-readable error or null.
export function bakeSizeError(topology: Topology, opts: BakeOptions): string | null {
  const totalFrames = Math.max(1, Math.round(opts.fps * opts.durationSec));
  const estimated = bakeChars(topology, totalFrames);
  if (estimated <= MAX_BAKE_CHARS) return null;
  return (
    `Bake too large: ${totalFrames.toLocaleString()} frames over the topology's outputs ` +
    `≈ ${Math.round(estimated / 1e6)}M chars of frame data (limit ${MAX_BAKE_CHARS / 1e6}M). ` +
    `Lower the FPS or duration, or split the show into shorter segments.`
  );
}

// Yield to the event loop without setTimeout(0): nested timers get clamped
// to ~4ms after a few iterations, which would make fast bakes spend most of
// their wall time asleep. MessageChannel posts are not throttled. One
// channel reused across bakes — the UI serializes bakes via its busy flag.
const yieldToEventLoop = (() => {
  const channel = new MessageChannel();
  let resolve: (() => void) | null = null;
  channel.port1.onmessage = () => {
    resolve?.();
    resolve = null;
  };
  return () =>
    new Promise<void>((r) => {
      resolve = r;
      channel.port2.postMessage(null);
    });
})();

// Bake N frames of `module` into a per-controller JSON bundle.
// Throws if the pattern's render throws (caller should surface to UI).
//
// Async so the UI can repaint mid-bake: after every YIELD_BUDGET_MS of
// work we fire `onProgress` and yield to the event loop via the
// MessageChannel helper above (not setTimeout — see its comment), so the
// progress bar updates and the window never feels frozen.
export async function bakeTopology(
  module: PatternModule,
  structure: Structure,
  leds: Led[],
  topology: Topology,
  cfg: ColorConfig,
  opts: BakeOptions,
  onProgress?: (p: BakeProgress) => void,
): Promise<WledBakedFile[]> {
  const ledCount = leds.length;
  const totalFrames = Math.max(1, Math.round(opts.fps * opts.durationSec));
  const dt = 1 / opts.fps;

  const sizeError = bakeSizeError(topology, opts);
  if (sizeError) throw new Error(sizeError);

  // Derived per-strip list so patterns that read `ctx.strips` (works in
  // both ring and rib layouts) see the same data they'd see at runtime.
  const strips = buildStrips(structure);

  // Give the module a chance to run setup.
  if (module.setup) {
    const setupCtx: SetupContext = { structure, leds, ledCount, strips };
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

  // Yield on elapsed time, not frame count: a fixed every-N-frames yield
  // punishes cheap patterns (they'd sleep more than they work) and starves
  // the UI on expensive ones. ~24ms of work per slice keeps the progress
  // bar and window responsive without measurable throughput cost.
  const YIELD_BUDGET_MS = 24;
  let lastYield = performance.now();

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
      strips,
      motion,
      audio,
      hsv: writeHsv,
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

    if (performance.now() - lastYield > YIELD_BUDGET_MS && f + 1 < totalFrames) {
      onProgress?.({ framesDone: f + 1, totalFrames });
      // eslint-disable-next-line no-await-in-loop
      await yieldToEventLoop();
      lastYield = performance.now();
    }
  }
  onProgress?.({ framesDone: totalFrames, totalFrames });

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
