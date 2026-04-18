// Inspector — per-LED color readout for the hover HUD.
//
// The Dome render loop writes each frame's raw 8-bit pattern bytes here
// (before gamma). The InspectorHUD component reads them on its own rAF
// cadence so we can show live color values without triggering re-renders
// every frame. The byte array is a *reference* to the renderer's internal
// rgbOut buffer — don't mutate it.

export type InspectorSnapshot = {
  rgbOut: Uint8ClampedArray | null;
  ledCount: number;
};

export const inspector: InspectorSnapshot = {
  rgbOut: null,
  ledCount: 0,
};
