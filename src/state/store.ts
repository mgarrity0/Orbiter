import { create } from 'zustand';
import {
  buildLeds,
  defaultStructure,
  Led,
  Structure,
  totalLedCount,
} from '../core/structure';
import { ColorConfig, defaultColorConfig } from '../core/colorSpace';
import type { PatternModule } from '../core/patternApi';
import { defaultMotionConfig, MotionConfig } from '../core/motion';
import { defaultTopology, Topology } from '../core/topology';
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

  setStructure: (s) =>
    set((state) => ({ structure: s, leds: ledsFor(s, state.calibration) })),
  patchStructure: (patch) =>
    set((state) => {
      const next = { ...state.structure, ...patch } as Structure;
      return { structure: next, leds: ledsFor(next, state.calibration) };
    }),
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
      pattern: {
        ...state.pattern,
        activeName: p.activePatternName,
      },
    })),

  setCalibration: (positions, sourceName) =>
    set((state) => {
      const cal: CalibrationState = {
        enabled: true,
        positions,
        sourceName,
        error: null,
      };
      return { calibration: cal, leds: ledsFor(state.structure, cal) };
    }),
  clearCalibration: () =>
    set((state) => ({
      calibration: defaultCalibration,
      leds: ledsFor(state.structure, defaultCalibration),
    })),
  setCalibrationEnabled: (enabled) =>
    set((state) => {
      const cal = { ...state.calibration, enabled };
      return { calibration: cal, leds: ledsFor(state.structure, cal) };
    }),
  setCalibrationError: (err) =>
    set((state) => ({ calibration: { ...state.calibration, error: err } })),

  hoveredLedIndex: null,
  setHoveredLed: (i) =>
    set((state) => (state.hoveredLedIndex === i ? state : { hoveredLedIndex: i })),
}));

// Non-reactive selector helpers -- for hot paths that shouldn't trigger
// re-renders (e.g. render loop reads).
export const getLeds = () => useAppStore.getState().leds;
export const getColorConfig = () => useAppStore.getState().colorConfig;
export const getTotalLedCount = () => totalLedCount(useAppStore.getState().structure);
