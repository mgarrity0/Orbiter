import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useAppStore } from '../../state/store';
import { Diffusion, ribMeridianPoints, ringPolyline } from '../../core/structure';
import { bakeFrameToLinearFloats } from '../../core/colorSpace';
import type { RenderContext, SetupContext } from '../../core/patternApi';
import { motionController } from '../../core/motion';
import { audioEngine } from '../../core/audio';

// Sphere geometry for one LED, reused across all instances.
const LED_RADIUS_METERS = 0.012;

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

  const ribPolylines = useMemo(() => {
    const out: Array<Array<[number, number, number]>> = [];
    for (let i = 0; i < structure.verticalRibCount; i++) {
      out.push(
        ribMeridianPoints(structure.diameterMeters, i, structure.verticalRibCount),
      );
    }
    return out;
  }, [structure.diameterMeters, structure.verticalRibCount]);

  const ringPolylines = useMemo(
    () =>
      structure.rings.map((r) => {
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
    return {
      rgbOut: new Uint8ClampedArray(ledCount * 3),
      linearOut: new Float32Array(ledCount * 3),
      haloLinearOut: new Float32Array(ledCount * 3),
    };
  }, [ledCount]);

  // Per-LED halo intensity looked up once from the ring's diffusion setting.
  // This multiplies the pattern color before writing to the halo mesh — so
  // each frame the halo tracks the core color but with ring-dependent
  // softness.
  const haloIntensity = useMemo(() => {
    const arr = new Float32Array(ledCount);
    for (let i = 0; i < leds.length; i++) {
      const ring = structure.rings[leds[i].ring];
      arr[i] = HALO_INTENSITY[ring?.diffusion ?? 'bare'];
    }
    return arr;
  }, [leds, structure.rings, ledCount]);

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
      m.makeTranslation(led.x, led.y, led.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, IDLE_COLOR);
      if (halo) {
        const ring = structure.rings[led.ring];
        const diff: Diffusion = ring?.diffusion ?? 'bare';
        const size = HALO_SIZE_METERS[diff];
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
  }, [leds, structure.rings]);

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

    const { activeModule, loadToken } = useAppStore.getState().pattern;

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
        const setupCtx: SetupContext = {
          structure: useAppStore.getState().structure,
          leds: useAppStore.getState().leds,
          ledCount,
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
      structure: useAppStore.getState().structure,
      leds: useAppStore.getState().leds,
      ledCount,
      motion: motionController.state,
      audio: audioEngine,
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

    const cfg = useAppStore.getState().colorConfig;
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
        >
          <sphereGeometry args={[LED_RADIUS_METERS, 8, 6]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      </group>
    </group>
  );
}
