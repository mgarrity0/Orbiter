# Orbiter

[![CI](https://github.com/mgarrity0/Orbiter/actions/workflows/ci.yml/badge.svg)](https://github.com/mgarrity0/Orbiter/actions/workflows/ci.yml)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/Three.js-0.169-000000?logo=three.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)

Orbiter is a desktop app for designing, simulating, and deploying LED patterns for a
16-foot half-dome WS2815 LED installation. It combines a real-time 3D simulator with
a hot-reloading JavaScript pattern runtime, motion + audio inputs, an on-device
controller topology editor, and exporters for WLED and FastLED hardware.

It runs as a Tauri 2 desktop app (Rust shell + webview frontend) so the same
codebase targets Windows, macOS, and Linux.

## Screenshots

> Drop screenshots / capture GIFs into `docs/screenshots/` with the filenames
> referenced below. See [docs/screenshots/README.md](docs/screenshots/README.md)
> for what to capture at what aspect ratio.

| | |
|---|---|
| ![Main viewer](docs/screenshots/01-viewer.png) | ![Pattern authoring](docs/screenshots/02-pattern.png) |
| *Main view — dome with `plasma` running and bloom enabled* | *Hot-reloading a pattern from `patterns/`* |
| ![Controllers panel](docs/screenshots/03-controllers.png) | ![Export panel](docs/screenshots/04-export.png) |
| *Topology editor with coverage warnings* | *Exporting WLED presets, baked frames, and FastLED sketches* |

---

## What it does

- **Previews patterns against the real dome geometry.** The dome is modeled in
  meters with its rim open at `y = 0` and its apex at `y = -r`; every LED's
  position, latitude, longitude, and index is available to the pattern.
- **Hot-reloads JavaScript pattern files.** Drop a `.js` into `patterns/`, select it
  in the Library panel, and edits in your editor reload automatically. No
  transpile step, no dev-server shenanigans — pattern files are ES modules.
- **Simulates WS2815 color reproduction end-to-end.** The same trim → color-order
  → brightness → gamma pipeline that the exporters bake for the hardware runs in
  the simulator, so the on-screen pixels match what the strips will emit.
- **Models dome motion and live audio** so reactive patterns can be authored and
  previewed without touching the physical install. Shift-drag to tilt the dome,
  hit the mic toggle to pipe FFT bins straight into the pattern context.
- **Edits controller topology.** Assign slices of the global LED chain to WLED or
  FastLED controllers + GPIO pins, with live coverage-issue warnings.
- **Exports in three formats** from the current topology:
  - WLED preset JSON (one file per WLED controller, segments per output),
  - WLED baked frame sequences (pre-rendered bytes, for streaming players),
  - FastLED `.ino` sketches (C++ with topology wiring, gamma LUT, and a demo loop).
- **Saves and loads project files** capturing the full editing state.

---

## Quick start

Prerequisites: Node 18+, Rust toolchain (for Tauri), and the Tauri 2 platform
requirements for your OS. See the [Tauri 2 prerequisites page](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

The first Rust build takes a couple of minutes. Subsequent launches are fast.

To build a standalone installer / bundle:

```bash
npm run tauri build
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Tauri webview (frontend)                 │
│                                                              │
│  ┌──────────┐  ┌──────────────────────────────────────────┐  │
│  │ Library  │  │                Viewer                     │  │
│  │ Panel    │  │  ┌─────────────────────────────────────┐  │  │
│  │          │  │  │      React Three Fiber canvas      │  │  │
│  │ (hot-    │  │  │      + InstancedMesh (LEDs)        │  │  │
│  │ reload)  │  │  │      + halo InstancedMesh          │  │  │
│  │          │  │  │      + Bloom / ACES ToneMapping    │  │  │
│  └──────────┘  │  └─────────────────────────────────────┘  │  │
│                └──────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Project · Structure · Motion · Audio · Controllers · Export ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  core/ — structure, colorSpace, motion, audio, topology, ││
│  │           patternApi, patternRuntime, project, exporters ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────┬───────────────────────────────────────────┘
                   │  tauri::invoke / emit
┌──────────────────┴───────────────────────────────────────────┐
│                   Rust backend (tauri-plugin-fs,             │
│                   tauri-plugin-dialog, notify)               │
│                                                              │
│   list_patterns / read_pattern / watch_patterns_dir          │
│   list_projects / read_project / write_project               │
│   write_export_files / project_root                          │
└──────────────────────────────────────────────────────────────┘
```

**State.** [zustand](https://github.com/pmndrs/zustand) holds all UI state. The
render-loop-hot paths (motion controller, audio engine) are module-level mutable
singletons that the render loop reads directly — zustand updates on those would
cause re-renders 60×/s, which we explicitly avoid.

**Render loop.** The `<Dome>` component owns the `useFrame` callback. Each frame:
motion controller updates → group rotation applied → audio engine samples →
pattern's `render(ctx, out)` fills an `Uint8ClampedArray` of linear 8-bit RGB
→ `bakeFrameToLinearFloats` applies trim/brightness/gamma/color-order → the
result lands in `InstancedMesh.instanceColor` as linear Float32s. The halo
InstancedMesh gets the same values multiplied by per-LED diffusion intensity.

---

## Directory layout

```
src/
  components/          React UI panels, viewer, dome renderer
    Dome/              InstancedMesh + halo + render loop
    Viewer/            Canvas, camera presets, drag-tilt, postprocessing
    Library/           Pattern list with hot-reload
    Project/           Save/load project files
    Structure/         Dome geometry editor
    Motion/            Motion source + rocking + recorder
    Audio/             Mic toggle + spectrum view
    Controllers/       Topology editor + coverage warnings
    Export/            WLED preset / WLED baked / FastLED export UI
  core/                Framework-agnostic logic
    structure.ts       Dome → LEDs geometry
    colorSpace.ts      WS2815 pipeline (trim → color-order → brightness → gamma)
    motion.ts          MotionController (idle / manual / rocking / playback)
    audio.ts           AudioEngine (Web Audio + FFT)
    topology.ts        Controller / output data model
    patternApi.ts      Public interface a pattern module implements
    patternRuntime.ts  Blob-URL dynamic import + file-watch wiring
    project.ts         Versioned project file format
    exporters/
      wledPreset.ts    Per-controller WLED preset JSON
      wledBaked.ts     Pre-rendered frame-sequence JSON
      arduinoFastled.ts  FastLED .ino generator
  state/
    store.ts           zustand store + non-reactive selectors

src-tauri/             Rust shell (Cargo)
  src/lib.rs           Tauri commands: file watch, pattern I/O,
                       project I/O, export writer

patterns/              User pattern modules (hot-reloaded)
projects/              Saved project files (created on first save)
```

---

## Pattern API

A pattern is a plain ES module. Minimum viable pattern:

```js
export const meta = {
  name: 'solid',
  description: 'one color, everywhere',
};

export function render(ctx, out) {
  for (let i = 0; i < ctx.ledCount; i++) {
    out[i * 3 + 0] = 255;
    out[i * 3 + 1] = 120;
    out[i * 3 + 2] = 30;
  }
}
```

`render(ctx, out)` is called once per frame. `out` is a `Uint8ClampedArray` of
length `ctx.ledCount * 3` to fill with linear 8-bit RGB. Orbiter applies the full
color pipeline after you return.

The `ctx` object:

| Field          | Type             | Notes |
|----------------|------------------|-------|
| `time`         | `number`         | seconds since pattern loaded |
| `dt`           | `number`         | seconds since previous frame (capped at 0.1) |
| `frame`        | `number`         | frame count since pattern loaded |
| `structure`    | `Structure`      | dome diameter, rib count, per-ring config |
| `leds`         | `Led[]`          | per-LED `{ i, ring, index, lat, lon, x, y, z, ringSize }` |
| `ledCount`     | `number`         | total LEDs |
| `motion`       | `MotionState`    | `{ pitch, roll, yaw, pitchVel, rollVel, yawVel }` in radians |
| `audio`        | `AudioState`     | `{ enabled, bins: Float32Array, energy, low, mid, high }` |

Optional `setup(ctx)` runs once when the pattern is (re-)loaded — a good place
to pre-compute lookup tables.

Seed patterns bundled in `patterns/`:
- **solid** — single color everywhere.
- **ring-chase** — a bright band walking down the rings.
- **plasma** — lat/lon noise plasma.
- **tilt-level** — stacked horizontal world-space bands that stay level while
  the dome rocks around its apex.
- **audio-bars** — polar FFT spectrum, color gradient by ring.

---

## Color pipeline

WS2815 strips are wired GRB internally, driven by a PWM shift register. The
simulator models the full path a byte takes from your pattern to the LED's
perceived color:

```
pattern out[] (linear 8-bit RGB)
  → * trim.{r,g,b}                   (per-channel calibration)
  → color-order reorder              (RGB / GRB / GBR / …)
  → * master brightness              (WLED-style duty-cycle scaling)
  → pow(v/255, gamma)                (gamma correction, default 2.6)
  → Float32 linear in [0,1]          (uploaded to InstancedMesh.instanceColor)
  → Canvas outputColorSpace = sRGB   (display-side encode)
```

All six steps are in `src/core/colorSpace.ts`. The FastLED exporter emits the
same gamma curve as a `PROGMEM` LUT so the physical strip sees identical values.

---

## Topology and exporters

The **Controllers** panel edits the assignment of the flat, global LED chain to
physical controllers. Each controller has one or more outputs; each output has
a GPIO pin, a `ledStart` (inclusive), and a `ledCount` (exclusive end). Coverage
is validated live — gaps, overlaps, and overflow are surfaced as warnings.

- **Auto-assign** creates one WLED controller per ring at `wled-N.local`.
- Flip kind to `FastLED` per controller if that output will be driven by an
  ESP32 running a custom sketch instead of WLED.

Three exporters are available from the Export panel:

### WLED preset

One JSON preset per WLED controller. Each controller's outputs become WLED
segments with **device-local** indices (WLED doesn't know about the global
chain). Upload via the WLED preset editor or POST to `/json/state`.

### WLED baked

Runs the active pattern in the simulator for `fps × durationSec` frames, pushes
every frame through the full color pipeline, and emits one JSON per WLED
controller containing hex-encoded wire bytes per frame. A companion player
script streams these to WLED over e.g. UDP DRGB. Motion and audio are held at
zero during bake.

### FastLED sketch

One `.ino` per FastLED controller with:
- per-output `CRGB` buffers wired to the configured GPIO pins,
- the gamma LUT baked in as a `PROGMEM` `uint8_t[256]`,
- the color-order template param wired correctly,
- master brightness matching the simulator's slider,
- a placeholder rainbow loop that proves wiring is correct.

Patterns aren't auto-transpiled to C++ — the sketch is a scaffold.

---

## Motion

Dome motion has four sources, selectable from the Motion panel:

- **idle** — springs to level, no input.
- **manual** — follows the shift-drag target, spring-damped; releases back to
  level. Drag is pitch/roll only.
- **rocking** — canned sinusoidal motion on `pitch`, `roll`, or both, with
  configurable amplitude (degrees) and frequency (Hz).
- **playback** — replays a recorded pitch/roll/yaw trace. Record toggles into a
  `MotionState[]` buffer at frame rate.

The dome pivots around its apex (the bottom vertex), implemented in `Dome.tsx`
as two nested groups: outer translated to the apex world position and rotated,
inner translating geometry back up by +radius so the dome-local origin lands at
the pivot point.

## Audio

`AudioEngine` is a module-level singleton that wraps `getUserMedia` +
`AnalyserNode` (fftSize=512). The Audio panel toggles the mic, draws a live
spectrum, and surfaces errors. The engine exposes `{ bins, energy, low, mid, high }`
to patterns. `low`/`mid`/`high` are simple thirds-splits of the bins — good
enough for drum/bass/vocals separation on most rooms.

---

## Project save/load

The **Project** panel saves the complete editing state (structure, color
config, topology, motion config, feature flags, active pattern name) to
`projects/{name}.json`. Files are versioned (`formatVersion`); bumping the
format invalidates only forward compatibility — older builds get a clean error
message.

On load, pattern source isn't restored from the project file — only the
pattern's filename is saved, and the LibraryPanel re-reads it from
`patterns/{name}` so the project stays small and shareable across machines with
a common `patterns/` folder.

---

## Viewer controls

- **Orbit** — left-drag rotates, right-drag pans, scroll zooms (OrbitControls).
- **Shift + drag** — tilts the dome (switches motion source to `manual`).
- **Front / Side / Top** buttons — camera tween presets.
- **Bloom / HDR toggles** — postprocessing. Bloom is on by default; HDR applies
  ACES filmic tone mapping.

Diffusion settings per ring (`bare`, `frosted`, `acrylic-band`) control per-LED
halo size and intensity via a second additive-blended InstancedMesh:
- `bare` — crisp, subtle halo.
- `frosted` — soft medium glow.
- `acrylic-band` — large overlapping halos that smear into a continuous band.

---

## Build

```bash
# Type-check (frontend)
npx tsc --noEmit

# Rust-side compile check
cd src-tauri && cargo check

# Production bundle (produces installer under src-tauri/target/release/bundle/)
npm run tauri build
```

---

## Roadmap / status

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Scaffold — Tauri app, zustand store, panel layout | ✅ |
| 1 | Structure data model, 3D renderer, camera presets | ✅ |
| 2 | Pattern runtime + hot-reload, seed patterns | ✅ |
| 3 | Motion (drag/rocking/playback) + audio (mic/FFT) | ✅ |
| 4 | Controller topology editor + three exporters | ✅ |
| 5 | Diffusion halos, project save/load, bloom/HDR | ✅ |
| 6 | Calibration, in-app Monaco editor, pixel inspector HUD, webcam overlay, 5 new seed patterns, CI | ✅ |

**Calibration** — import/export a JSON file of captured LED positions
(format v1: `{ formatVersion, ledCount, units: "meters", positions: [x,y,z,…] }`)
from the Calibration panel. Toggle between synthetic and captured modes
to compare; Export Current seeds a file you can refine externally.

**Pattern inspector** — hover any LED in the viewer to see its ring,
per-ring index, dome-local coordinates, and the pattern's current RGB
output (pre-gamma). A floating HUD tracks the cursor.

**In-app pattern editor** — click "Edit patterns" in the header to open a
Monaco-powered editor over the viewer. Save with Ctrl/Cmd+S; the notify
watcher picks up the write and hot-reloads the active pattern. The
"New…" button scaffolds a fresh pattern file from a template.

**Webcam overlay** — toggle a live camera feed over the 3D canvas with
tunable opacity and an optional mirror. Point a camera at the real dome
for side-by-side alignment + color-temperature comparison.

**New seed patterns:** `starfield`, `lightning`, `beat-pulse` (kick-reactive
radial ripples), `audio-gradient` (latitude gradient steered by
low/mid/high bands), `rainstorm`.

Open directions post-phase-6: BOM / wiring-diagram generator, on-device
frame streamer for baked output, deploy-and-flash tooling from the
Export panel.

---

## Stack

- [Tauri 2](https://v2.tauri.app) — Rust shell + webview
- [React 18](https://react.dev) + TypeScript + [Vite](https://vitejs.dev)
- [Three.js](https://threejs.org) via [@react-three/fiber](https://r3f.docs.pmnd.rs) + [drei](https://drei.docs.pmnd.rs)
- [@react-three/postprocessing](https://github.com/pmndrs/react-postprocessing) (bloom, ACES tone mapping)
- [zustand](https://github.com/pmndrs/zustand) for UI state
- [notify](https://github.com/notify-rs/notify) for pattern file watching
