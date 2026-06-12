// WS2815 gamma + brightness, and the color-order *description*.
//
// The point of this module is sim/hardware parity: the values we send to the
// renderer (and that the exporters will bake or emit) must be the same values
// the physical LEDs will see, so the phone-photo side-by-side test from §10.2
// of the plan lines up.
//
// Pipeline (pattern output -> on-screen pixel):
//   1. Pattern writes linear 8-bit RGB into the frame buffer (`out[i*3+0..2]`).
//   2. applyBrightness() scales by the brightness slider (WS2815 duty cycle).
//   3. applyGamma() maps each channel through pow(v/255, gamma).
//   4. Result is uploaded to InstancedMesh instance-color buffer as floats
//      in [0,1] (Three.js wants linear floats; we set its output encoding to
//      sRGB so display math is correct).
//
// Channel reordering is deliberately NOT part of this pipeline. `colorOrder`
// describes how the strip is wired; the component that physically drives the
// strip applies it — FastLED via the addLeds<> template parameter, WLED via
// its bus config (the baked exporter records it in metadata for the player
// to configure). Both the simulator and exported byte streams therefore stay
// in authored RGB order, and applying the reorder twice (sim + firmware) is
// structurally impossible.

export type ColorOrder = 'RGB' | 'RBG' | 'GRB' | 'GBR' | 'BRG' | 'BGR';
export const COLOR_ORDERS: ColorOrder[] = ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'];

export type ColorTrim = {
  // Per-channel trim multipliers, applied BEFORE gamma. 1.0 = no trim.
  r: number;
  g: number;
  b: number;
};

export type ColorConfig = {
  // Gamma for each channel. WS2815 is a shift register driving PWM; the
  // "gamma" is perceptual + PWM linearity. 2.6 is the value most FastLED
  // users land on for these chips.
  gamma: number;
  // Duty-cycle brightness (0..1). Applied linearly to the 8-bit value
  // before gamma, matching how WLED / FastLED scale master brightness.
  brightness: number;
  colorOrder: ColorOrder;
  trim: ColorTrim;
};

export const defaultColorConfig: ColorConfig = {
  gamma: 2.6,
  brightness: 0.6,
  // Describes the wiring, applied only by the driving firmware (see module
  // header): WS2815 is GRB on the wire. The simulator always shows authored
  // colors regardless of this value.
  colorOrder: 'GRB',
  trim: { r: 1.0, g: 1.0, b: 1.0 },
};

// ---------- single-pixel helpers ----------

export function applyBrightness(v: number, brightness: number): number {
  // v in 0..255, returns 0..255
  return Math.max(0, Math.min(255, v * brightness));
}

export function applyGamma(v: number, gamma: number): number {
  // v in 0..255, returns linear float in [0,1] suitable for a Three.js
  // instance-color buffer (Canvas `outputColorSpace` = sRGB will do the
  // sRGB encoding step for us).
  const n = Math.max(0, Math.min(1, v / 255));
  return Math.pow(n, gamma);
}

// ---------- frame-wide helper ----------

/**
 * Take a pattern's linear 8-bit output buffer and produce a Float32 linear
 * buffer ready for Three.js InstancedMesh.instanceColor.
 *
 * `rgbOut` length = ledCount * 3.
 * `linearOut` length = ledCount * 3 (filled in place).
 */
export function bakeFrameToLinearFloats(
  rgbOut: Uint8ClampedArray,
  linearOut: Float32Array,
  cfg: ColorConfig,
): void {
  const { gamma, brightness, trim } = cfg;
  const n = rgbOut.length;
  for (let i = 0; i < n; i += 3) {
    const rIn = rgbOut[i + 0] * trim.r;
    const gIn = rgbOut[i + 1] * trim.g;
    const bIn = rgbOut[i + 2] * trim.b;
    linearOut[i + 0] = applyGamma(applyBrightness(rIn, brightness), gamma);
    linearOut[i + 1] = applyGamma(applyBrightness(gIn, brightness), gamma);
    linearOut[i + 2] = applyGamma(applyBrightness(bIn, brightness), gamma);
  }
}

// Produce a 256-entry gamma LUT for exporters (e.g. the FastLED sketch uses
// this table at runtime on the ESP32). Returns 0..255 byte values — the
// round-trip a real strip will see after the controller applies the same
// curve.
export function gammaLut(gamma: number): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(Math.pow(i / 255, gamma) * 255);
  }
  return lut;
}
