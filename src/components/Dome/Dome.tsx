import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useAppStore } from '../../state/store';
import {
  buildStrips,
  Diffusion,
  ribChannelPolyline,
  ribMeridianPoints,
  ringPolyline,
} from '../../core/structure';
import { bakeFrameToLinearFloats } from '../../core/colorSpace';
import { writeHsv, type RenderContext, type SetupContext } from '../../core/patternApi';
import { motionController } from '../../core/motion';
import { audioEngine } from '../../core/audio';
import { inspector } from '../../core/inspector';

// Sphere geometry for one LED, reused across all instances. Hole-mounted
// point LEDs ('points' strips) render larger — a drilled hole with a pixel
// behind it reads as a fat dot next to the channel strip, not another
// strip LED.
const LED_RADIUS_METERS = 0.012;
const POINT_LED_SCALE = 2.2;
const POINT_HALO_SCALE = 1.6;

// Diffusion → halo size (radius in meters) and intensity (0..1 multiplier
// on the pattern color before additive blending). 'bare' still gets a
// whisper of halo so specular LEDs don't feel sterile against the black
// background. 'acrylic-band' is sized large enough that adjacent LEDs on
// a 60/m strip smear into a continuous band.
const HALO_SIZE_METERS: Record<Diffusion, number> = {
  bare: 0.018,
  frosted: 0.055,
  'acrylic-band': 0.12,
};
const HALO_INTENSITY: Record<Diffusion, number> = {
  bare: 0.25,
  frosted: 0.5,
  'acrylic-band': 0.75,
};

// Color applied to every instance when no pattern is loaded.
const IDLE_COLOR = new THREE.Color(0.03, 0.03, 0.03);

export function Dome() {
  const structure = useAppStore((s) => s.structure);
  const leds = useAppStore((s) => s.leds);
  const setHoveredLed = useAppStore((s) => s.setHoveredLed);
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const haloRef = useRef<THREE.InstancedMesh>(null!);
  const groupRef = useRef<THREE.Group>(null!);

  // The dome pivots around its apex (bottom vertex), not its rim center.
  // We implement this with two nested groups: the outer group is translated
  // so the apex position is at (0, -radius, 0) in world space *and* rotation
  // is applied there; the inner group translates geometry back up by
  // +radius so dome-local (0, -r, 0) lands at outer-local origin, i.e. the
  // pivot point. See comment in the JSX return below.
  const radius = structure.diameterMeters / 2;

  // Structural frame polylines — the plywood rib centerlines. Their extent
  // is frame geometry (frameApexLatitudeDeg), independent of which LED
  // layout is active: switching ring/rib LED configs never moves the frame.
  // The count is truncated the same way buildStrips/buildLeds truncate it,
  // so the drawn ribs and the LED placement can never disagree on rib
  // count or longitude spacing.
  const frameApexDeg = structure.frameApexLatitudeDeg;
  const ribCount = Math.max(1, structure.verticalRibCount | 0);
  const ribPolylines = useMemo(() => {
    const out: Array<Array<[number, number, number]>> = [];
    for (let i = 0; i < ribCount; i++) {
      out.push(ribMeridianPoints(structure.diameterMeters, i, ribCount, 32, frameApexDeg));
    }
    return out;
  }, [structure.diameterMeters, ribCount, frameApexDeg]);

  // The routed channel on each rib face — the wavy groove the LED strip
  // sits in. Drawn slightly brighter than the frame so the squiggle reads
  // even while LEDs idle. Segment count is wave-adaptive (see
  // ribChannelPolyline) so high-cycle squiggles don't alias.
  const channelPolylines = useMemo(() => {
    if (structure.layout !== 'ribs') return [];
    const out: Array<Array<[number, number, number]>> = [];
    for (let i = 0; i < ribCount; i++) {
      out.push(ribChannelPolyline(structure.diameterMeters, structure.rib, i, ribCount));
    }
    return out;
  }, [structure.layout, structure.diameterMeters, structure.rib, ribCount]);

  // Ring polylines are only drawn in ring mode — in rib mode the structural
  // lines are the ribs, and painting horizontal rings over them would just
  // look like a double-dome.
  const ringPolylines = useMemo(
    () =>
      structure.layout === 'ribs'
        ? []
        : structure.rings.map((r) => {
            const pts = ringPolyline(structure.diameterMeters, r.latitudeDeg, 128);
            // Close the loop for the Line renderer.
            pts.push(pts[0]);
            return pts;
          }),
    [structure],
  );

  // Buffers for the gamma pipeline. Re-alloc only when the LED count changes.
  const ledCount = leds.length;
  const buffers = useMemo(() => {
    const b = {
      rgbOut: new Uint8ClampedArray(ledCount * 3),
      linearOut: new Float32Array(ledCount * 3),
      haloLinearOut: new Float32Array(ledCount * 3),
    };
    // Publish the pattern-byte buffer to the inspector so the hover HUD
    // can show live color values without duplicating the pipeline.
    inspector.rgbOut = b.rgbOut;
    inspector.ledCount = ledCount;
    return b;
  }, [ledCount]);

  // Derived per-strip list. Always correct for the active layout, so the
  // halo-intensity lookup below doesn't have to branch on structure.layout.
  const strips = useMemo(() => buildStrips(structure), [structure]);

  // Per-LED halo intensity looked up once from the strip's diffusion
  // setting. Each frame the halo tracks the core color but with strip-
  // dependent softness. `ledCount` is derived from `leds.length`, so
  // leaving it out of the deps doesn't miss any updates.
  const haloIntensity = useMemo(() => {
    const arr = new Float32Array(leds.length);
    for (let i = 0; i < leds.length; i++) {
      const strip = strips[leds[i].ring];
      arr[i] = HALO_INTENSITY[strip?.diffusion ?? 'bare'];
    }
    return arr;
  }, [leds, strips]);

  // Write positions + idle color whenever the LED list changes. The render
  // loop below may overwrite colors on every frame once a pattern is active.
  useEffect(() => {
    const mesh = meshRef.current;
    const halo = haloRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const mh = new THREE.Matrix4();
    for (let i = 0; i < leds.length; i++) {
      const led = leds[i];
      const strip = strips[led.ring];
      const isPoint = strip?.kind === 'points';
      const k = isPoint ? POINT_LED_SCALE : 1;
      m.makeScale(k, k, k).setPosition(led.x, led.y, led.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, IDLE_COLOR);
      if (halo) {
        const diff: Diffusion = strip?.diffusion ?? 'bare';
        const size = HALO_SIZE_METERS[diff] * (isPoint ? POINT_HALO_SCALE : 1);
        mh.makeScale(size, size, size).setPosition(led.x, led.y, led.z);
        halo.setMatrixAt(i, mh);
        halo.setColorAt(i, IDLE_COLOR);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (halo) {
      halo.instanceMatrix.needsUpdate = true;
      if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
    }
  }, [leds, strips]);

  // --- Motion + audio + pattern render loop --------------------------------
  //
  // Order each frame:
  //   1. Update motion controller (reads zustand config, mutates state).
  //   2. Apply motion state to the group's rotation.
  //   3. Update audio engine (reads analyser, fills bins).
  //   4. If a pattern is active, render it and bake to instanceColor.
  //
  // We read the active pattern through zustand directly inside useFrame so
  // pattern swaps don't tear down the whole loop. Time / frame counters reset
  // whenever `loadToken` ticks (new module loaded).
  const timing = useRef({ t0: performance.now(), last: performance.now(), frame: 0, token: -1 });

  useFrame(() => {
    const mesh = meshRef.current;
    const halo = haloRef.current;
    const group = groupRef.current;
    if (!mesh || !group) return;

    const now = performance.now();
    const timingRef = timing.current;
    const globalT = now / 1000;
    const dt = Math.min(0.1, (now - timingRef.last) / 1000);

    // Motion + audio always run, independent of pattern activity.
    motionController.update(globalT, dt);
    group.rotation.set(
      motionController.state.pitch,
      motionController.state.yaw,
      motionController.state.roll,
    );
    audioEngine.update();

    const appState = useAppStore.getState();

    // The baked exporter shares the (stateful) pattern module. While it's
    // rendering, the live loop must not touch the module or its frames
    // would interleave with the bake's — the exporter bumps loadToken when
    // it finishes, so setup() re-runs and live state resets cleanly.
    if (appState.baking) {
      timingRef.last = now;
      return;
    }

    // The store can be ahead of this component: a structure change rebuilds
    // state.leds synchronously, but the closure's `leds`/`ledCount`/`strips`
    // only refresh after the React commit. Consuming loadToken now would run
    // setup() against a mismatched snapshot — and the consumed token means it
    // would never be corrected. Skip the frame; the commit lands within a
    // frame and the world is consistent again.
    if (appState.leds !== leds) {
      timingRef.last = now;
      return;
    }

    const { activeModule, loadToken } = appState.pattern;

    if (!activeModule) {
      // No pattern — blank to idle once on the stop transition, then sleep
      // the color path. Still advance timing.last so future pattern start
      // has a reasonable dt.
      if (loadToken !== timingRef.token) {
        timingRef.token = loadToken;
        const ic = mesh.instanceColor;
        if (ic) {
          for (let i = 0; i < leds.length; i++) {
            mesh.setColorAt(i, IDLE_COLOR);
          }
          ic.needsUpdate = true;
        }
        if (halo) {
          const hic = halo.instanceColor;
          if (hic) {
            for (let i = 0; i < leds.length; i++) halo.setColorAt(i, IDLE_COLOR);
            hic.needsUpdate = true;
          }
        }
      }
      timingRef.last = now;
      return;
    }

    if (loadToken !== timingRef.token) {
      timingRef.token = loadToken;
      timingRef.t0 = now;
      timingRef.frame = 0;

      if (activeModule.setup) {
        // The guard above proved the closure matches the store, so these
        // are a consistent snapshot.
        const setupCtx: SetupContext = {
          structure,
          leds,
          ledCount,
          strips,
        };
        try {
          activeModule.setup(setupCtx);
        } catch (e) {
          useAppStore.getState().setPatternError(`setup: ${String(e)}`);
          timingRef.last = now;
          return;
        }
      }
    }

    const ctx: RenderContext = {
      time: (now - timingRef.t0) / 1000,
      dt,
      frame: timingRef.frame,
      structure,
      leds,
      ledCount,
      strips,
      motion: motionController.state,
      audio: audioEngine,
      hsv: writeHsv,
    };
    timingRef.last = now;
    timingRef.frame++;

    const { rgbOut, linearOut } = buffers;
    rgbOut.fill(0);
    try {
      activeModule.render(ctx, rgbOut);
    } catch (e) {
      useAppStore.getState().setPatternError(`render: ${String(e)}`);
      return;
    }

    const cfg = appState.colorConfig;
    bakeFrameToLinearFloats(rgbOut, linearOut, cfg);

    const ic = mesh.instanceColor;
    if (ic) {
      (ic.array as Float32Array).set(linearOut);
      ic.needsUpdate = true;
    }

    // Halo colors = pattern colors scaled by per-LED halo intensity, so
    // 'bare' rings glow subtly while 'acrylic-band' rings smear into a
    // continuous band. Additive blending on the halo material lets these
    // overlap and accumulate.
    if (halo) {
      const { haloLinearOut } = buffers;
      for (let i = 0; i < ledCount; i++) {
        const k = haloIntensity[i];
        const o = i * 3;
        haloLinearOut[o + 0] = linearOut[o + 0] * k;
        haloLinearOut[o + 1] = linearOut[o + 1] * k;
        haloLinearOut[o + 2] = linearOut[o + 2] * k;
      }
      const hic = halo.instanceColor;
      if (hic) {
        (hic.array as Float32Array).set(haloLinearOut);
        hic.needsUpdate = true;
      }
    }
  });

  return (
    // Outer group: positioned where the pivot should live in world space
    // (the apex at y=-r). Its rotation is set each frame from motion state,
    // so rotation happens around this point. The inner group re-offsets the
    // dome geometry upward by +r so its apex lands at the pivot origin.
    <group ref={groupRef} position={[0, -radius, 0]}>
      <group position={[0, radius, 0]}>
        {ribPolylines.map((pts, i) => (
          <Line
            key={`rib-${i}`}
            points={pts}
            color="#1a1a1a"
            lineWidth={1.2}
            transparent
            opacity={0.85}
          />
        ))}
        {channelPolylines.map((pts, i) => (
          <Line
            key={`channel-${i}`}
            points={pts}
            color="#2f3a4a"
            lineWidth={1}
            transparent
            opacity={0.7}
          />
        ))}
        {ringPolylines.map((pts, i) => (
          <Line
            key={`ring-${i}`}
            points={pts}
            color="#2a2a2a"
            lineWidth={1.6}
            transparent
            opacity={0.9}
          />
        ))}
        <instancedMesh
          ref={haloRef}
          args={[undefined, undefined, Math.max(1, leds.length)]}
          frustumCulled={false}
          renderOrder={-1}
        >
          {/* Unit sphere scaled per-instance via instanceMatrix; size in
              meters is encoded in the scale, so geometry stays a cheap
              low-poly unit sphere. */}
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial
            toneMapped={false}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </instancedMesh>
        <instancedMesh
          ref={meshRef}
          args={[undefined, undefined, Math.max(1, leds.length)]}
          frustumCulled={false}
          onPointerMove={(e) => {
            e.stopPropagation();
            if (typeof e.instanceId === 'number') {
              setHoveredLed(e.instanceId);
            }
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            setHoveredLed(null);
          }}
        >
          <sphereGeometry args={[LED_RADIUS_METERS, 8, 6]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      </group>
    </group>
  );
}
