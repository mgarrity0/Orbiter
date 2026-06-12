import { create } from 'zustand';
import {
  buildLeds,
  buildStrips,
  defaultStructure,
  Led,
  Structure,
  totalLedCount,
} from '../core/structure';
import { ColorConfig, defaultColorConfig } from '../core/colorSpace';
import type { PatternModule } from '../core/patternApi';
import { defaultMotionConfig, MotionConfig } from '../core/motion';
import {
  defaultTopology,
  reconcileTopology,
  topologyMatchesAutoShape,
  Topology,
} from '../core/topology';
import type { ProjectFile } from '../core/project';
import {
  applyCalibration,
  CalibrationState,
  defaultCalibration,
} from '../core/calibration';

export type CameraPreset = 'orbit' | 'front' | 'side' | 'top';

export type FeatureFlags = {
  // Deferred to Phase 5; exposed here so the renderer can read them without
  // a refactor when we turn them on.
  bloom: boolean;
  hdr: boolean;
};

export type PatternState = {
  available: string[];
  activeName: string | null;
  activeModule: PatternModule | null;
  // Set when load or render throws; cleared on next successful load/render.
  error: string | null;
  // Incremented every time the active module is replaced — lets the render
  // loop reset its time/frame counters without extra coupling.
  loadToken: number;
};

export type AudioUIState = {
  // Whether the user has toggled the mic on. Actual enable is async; reflect
  // the *intent* here and the engine's real `enabled` field for the truth.
  requested: boolean;
  error: string | null;
};

export type AppState = {
  structure: Structure;
  leds: Led[];
  colorConfig: ColorConfig;
  cameraPreset: CameraPreset;
  featureFlags: FeatureFlags;
  pattern: PatternState;
  motionConfig: MotionConfig;
  audio: AudioUIState;
  topology: Topology;

  setStructure: (s: Structure) => void;
  patchStructure: (patch: Partial<Structure>) => void;
  setColorConfig: (c: ColorConfig) => void;
  patchColorConfig: (patch: Partial<ColorConfig>) => void;
  setCameraPreset: (p: CameraPreset) => void;

  setAvailablePatterns: (names: string[]) => void;
  setActivePattern: (name: string | null, mod: PatternModule | null) => void;
  setPatternError: (err: string | null) => void;

  setMotionConfig: (m: MotionConfig) => void;
  patchMotionConfig: (patch: Partial<MotionConfig>) => void;
  patchRocking: (patch: Partial<MotionConfig['rocking']>) => void;

  setAudioRequested: (req: boolean) => void;
  setAudioError: (err: string | null) => void;

  setTopology: (t: Topology) => void;

  projectName: string;
  setProjectName: (name: string) => void;
  applyProjectFile: (p: ProjectFile) => void;

  calibration: CalibrationState;
  setCalibration: (positions: Float32Array, sourceName: string) => void;
  clearCalibration: () => void;
  setCalibrationEnabled: (enabled: boolean) => void;
  setCalibrationError: (err: string | null) => void;

  // Pattern inspector — LED index under the cursor, or null when not
  // hovering any LED. Set by the Dome's raycast; read by the HUD overlay.
  hoveredLedIndex: number | null;
  setHoveredLed: (i: number | null) => void;

  // True while the baked exporter is rendering frames. The Dome's frame
  // loop pauses the live pattern render so the bake has exclusive use of
  // the (stateful) pattern module — see bakeTopology.
  baking: boolean;
  setBaking: (b: boolean) => void;
  // Re-run the active pattern's setup() on the next frame. Callers that
  // mutate module state outside the frame loop (the baked exporter) use
  // this to reset the live pattern afterwards.
  reloadActivePattern: () => void;
};

const initialStructure = defaultStructure();

// Rebuild the LED list from a structure and optionally overlay captured
// positions. The overlay is a no-op when calibration is disabled or the
// position buffer doesn't match the structure's total LED count.
function ledsFor(structure: Structure, cal: CalibrationState): Led[] {
  const base = buildLeds(structure);
  if (!cal.enabled || !cal.positions) return base;
  return applyCalibration(base, cal.positions);
}

// Bump loadToken on the pattern state so the render loop re-runs setup()
// with the new led list — patterns that allocate per-LED state in setup()
// would otherwise read stale buffers with the wrong ledCount. Only the
// helpers below call this for geometry changes; they bump strictly when the
// LED list actually changed, so e.g. a diffusion edit no longer restarts a
// running pattern from t=0.
function withBumpedLoadToken(pattern: PatternState): PatternState {
  return { ...pattern, loadToken: pattern.loadToken + 1 };
}

function ledsEqual(a: Led[], b: Led[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    // lat/lon must be compared independently of x/y/z: a calibration
    // overlay pins x/y/z to captured values, so a latitude-only structure
    // edit changes the parametric fields patterns read while leaving
    // positions identical.
    if (
      p.x !== q.x ||
      p.y !== q.y ||
      p.z !== q.z ||
      p.lat !== q.lat ||
      p.lon !== q.lon ||
      p.ring !== q.ring
    ) {
      return false;
    }
  }
  return true;
}

// Address-space fingerprint of a structure — anything the controller
// topology depends on (strip order, sizes, chipsets). Positions are
// deliberately excluded: calibration moves LEDs without re-addressing them.
function stripSig(s: Structure): string {
  return buildStrips(s)
    .map((p) => `${p.startIndex}:${p.ledCount}:${p.kind}:${p.chipset}`)
    .join('|');
}

// Every consequence of a structure change lives here so no action can
// forget one of them: rebuild the LED list, regenerate the topology's
// now-stale address ranges, restart the active pattern, and surface a
// calibration that no longer fits — each only when actually needed.
//
// Topology policy: an untouched auto-generated topology silently tracks
// the structure (so exports can never address a LED list that no longer
// exists), but a hand-customized one is never clobbered — its stale
// ranges surface as coverage warnings and the user re-syncs explicitly
// via Auto-assign.
function withStructureApplied(state: AppState, next: Structure): Partial<AppState> {
  const base = buildLeds(next);
  const cal = state.calibration;
  const calActive = cal.enabled && !!cal.positions;
  const calMismatch = calActive && cal.positions!.length !== base.length * 3;
  const leds = calActive && !calMismatch ? applyCalibration(base, cal.positions) : base;
  const changed = !ledsEqual(state.leds, leds);
  const topologyStale =
    stripSig(state.structure) !== stripSig(next) &&
    topologyMatchesAutoShape(state.topology, state.structure);
  return {
    structure: next,
    leds: changed ? leds : state.leds,
    ...(topologyStale ? { topology: reconcileTopology(state.topology, next) } : {}),
    ...(changed ? { pattern: withBumpedLoadToken(state.pattern) } : {}),
    // The overlay silently no-ops on a count mismatch (applyCalibration);
    // without this the panel would keep claiming captured positions while
    // the viewport renders synthetic ones.
    ...(calActive
      ? {
          calibration: {
            ...cal,
            error: calMismatch
              ? `captured positions cover ${cal.positions!.length / 3} LEDs but the structure now has ${base.length} — showing synthetic positions until they match again`
              : null,
          },
        }
      : {}),
  };
}

// Calibration moves LED positions but never re-addresses strips, so the
// topology is untouched here by construction.
function withCalibrationApplied(state: AppState, cal: CalibrationState): Partial<AppState> {
  const leds = ledsFor(state.structure, cal);
  const changed = !ledsEqual(state.leds, leds);
  return {
    calibration: cal,
    leds: changed ? leds : state.leds,
    ...(changed ? { pattern: withBumpedLoadToken(state.pattern) } : {}),
  };
}

export const useAppStore = create<AppState>((set) => ({
  structure: initialStructure,
  leds: buildLeds(initialStructure),
  colorConfig: defaultColorConfig,
  cameraPreset: 'orbit',
  featureFlags: { bloom: true, hdr: false },
  pattern: {
    available: [],
    activeName: null,
    activeModule: null,
    error: null,
    loadToken: 0,
  },
  motionConfig: defaultMotionConfig,
  audio: { requested: false, error: null },
  topology: defaultTopology(initialStructure),
  projectName: 'untitled',
  calibration: defaultCalibration,

  setStructure: (s) => set((state) => withStructureApplied(state, s)),
  patchStructure: (patch) =>
    set((state) =>
      withStructureApplied(state, { ...state.structure, ...patch } as Structure),
    ),
  setColorConfig: (c) => set({ colorConfig: c }),
  patchColorConfig: (patch) =>
    set((state) => ({ colorConfig: { ...state.colorConfig, ...patch } })),
  setCameraPreset: (p) => set({ cameraPreset: p }),

  setAvailablePatterns: (names) =>
    set((state) => ({ pattern: { ...state.pattern, available: names } })),
  setActivePattern: (name, mod) =>
    set((state) => ({
      pattern: {
        ...state.pattern,
        activeName: name,
        activeModule: mod,
        error: null,
        loadToken: state.pattern.loadToken + 1,
      },
    })),
  setPatternError: (err) =>
    set((state) => ({ pattern: { ...state.pattern, error: err } })),

  setMotionConfig: (m) => set({ motionConfig: m }),
  patchMotionConfig: (patch) =>
    set((state) => ({ motionConfig: { ...state.motionConfig, ...patch } })),
  patchRocking: (patch) =>
    set((state) => ({
      motionConfig: {
        ...state.motionConfig,
        rocking: { ...state.motionConfig.rocking, ...patch },
      },
    })),

  setAudioRequested: (req) =>
    set((state) => ({ audio: { ...state.audio, requested: req } })),
  setAudioError: (err) =>
    set((state) => ({ audio: { ...state.audio, error: err } })),

  setTopology: (t) => set({ topology: t }),

  setProjectName: (name) => set({ projectName: name }),
  applyProjectFile: (p) =>
    set((state) => ({
      projectName: p.name,
      structure: p.structure,
      leds: ledsFor(p.structure, state.calibration),
      colorConfig: p.colorConfig,
      topology: p.topology,
      motionConfig: p.motionConfig,
      featureFlags: p.featureFlags,
      // Keep the pattern runtime state intact — the project only records
      // the *name*; LibraryPanel is responsible for actually loading the
      // module by invoking read_pattern + setActivePattern after this.
      // Bump loadToken so any currently-running pattern re-runs setup()
      // against the new leds array (prevents stale per-LED state from the
      // prior project's structure).
      pattern: withBumpedLoadToken({
        ...state.pattern,
        activeName: p.activePatternName,
      }),
    })),

  setCalibration: (positions, sourceName) =>
    set((state) =>
      withCalibrationApplied(state, {
        enabled: true,
        positions,
        sourceName,
        error: null,
      }),
    ),
  clearCalibration: () =>
    set((state) => withCalibrationApplied(state, defaultCalibration)),
  setCalibrationEnabled: (enabled) =>
    set((state) =>
      withCalibrationApplied(state, { ...state.calibration, enabled }),
    ),
  setCalibrationError: (err) =>
    set((state) => ({ calibration: { ...state.calibration, error: err } })),

  hoveredLedIndex: null,
  setHoveredLed: (i) =>
    set((state) => (state.hoveredLedIndex === i ? state : { hoveredLedIndex: i })),

  baking: false,
  setBaking: (b) => set({ baking: b }),
  reloadActivePattern: () =>
    set((state) => ({ pattern: withBumpedLoadToken(state.pattern) })),
}));

// Non-reactive selector helpers -- for hot paths that shouldn't trigger
// re-renders (e.g. render loop reads).
export const getLeds = () => useAppStore.getState().leds;
export const getColorConfig = () => useAppStore.getState().colorConfig;
export const getTotalLedCount = () => totalLedCount(useAppStore.getState().structure);
