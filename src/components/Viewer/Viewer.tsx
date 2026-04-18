import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useAppStore, CameraPreset } from '../../state/store';
import { Dome } from '../Dome';
import { InspectorHUD } from './InspectorHUD';
import { WebcamOverlay } from './WebcamOverlay';
import { motionController } from '../../core/motion';

// Positions chosen so the dome (radius ~2.44m, hanging below origin with open
// rim at y=0 and apex at y=-r) fits comfortably in the default FOV. Target is
// at the dome's vertical midpoint (~-1.2m) so the frame composition looks
// natural from all three axes. The 'top' preset looks straight down from
// above, through the open rim.
type CamView = { pos: [number, number, number]; target: [number, number, number] };
const PRESETS: Record<Exclude<CameraPreset, 'orbit'>, CamView> = {
  front: { pos: [0, -1.2, 8], target: [0, -1.2, 0] },
  side: { pos: [8, -1.2, 0], target: [0, -1.2, 0] },
  top: { pos: [0, 6, 0.001], target: [0, -1.2, 0] },
};

// Radians per pixel of drag. ~0.3°/px feels natural for small gestures;
// combined with the 45° clamp below, edge-to-edge screen drag saturates.
const DRAG_SENSITIVITY = (0.3 * Math.PI) / 180;
const DRAG_MAX_RAD = (45 * Math.PI) / 180;

type TweenState = {
  t: number;
  duration: number;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
};

function CameraController() {
  const preset = useAppStore((s) => s.cameraPreset);
  const setPreset = useAppStore((s) => s.setCameraPreset);
  const { camera } = useThree();
  // OrbitControls type is an Events class with .target — treat as any to
  // avoid wrestling with the three-stdlib re-export.
  const controlsRef = useRef<any>(null);
  const tween = useRef<TweenState | null>(null);

  useEffect(() => {
    if (preset === 'orbit') return;
    const view = PRESETS[preset];
    if (!view || !controlsRef.current) return;
    tween.current = {
      t: 0,
      duration: 0.6,
      startPos: camera.position.clone(),
      endPos: new THREE.Vector3(...view.pos),
      startTarget: controlsRef.current.target.clone(),
      endTarget: new THREE.Vector3(...view.target),
    };
  }, [preset, camera]);

  useFrame((_, delta) => {
    const t = tween.current;
    if (!t) return;
    t.t = Math.min(1, t.t + delta / t.duration);
    const e = 1 - Math.pow(1 - t.t, 3); // easeOutCubic
    camera.position.lerpVectors(t.startPos, t.endPos, e);
    controlsRef.current?.target.lerpVectors(t.startTarget, t.endTarget, e);
    controlsRef.current?.update();
    if (t.t >= 1) {
      tween.current = null;
      // Drop back to 'orbit' so clicking the same preset button again
      // re-triggers the tween next time.
      setPreset('orbit');
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      target={[0, -1.2, 0]}
      enableDamping
      dampingFactor={0.08}
      minDistance={1}
      maxDistance={40}
    />
  );
}

function Toolbar() {
  const setPreset = useAppStore((s) => s.setCameraPreset);
  const bloom = useAppStore((s) => s.featureFlags.bloom);
  const hdr = useAppStore((s) => s.featureFlags.hdr);
  const setFeatureFlag = (key: 'bloom' | 'hdr', value: boolean) =>
    useAppStore.setState((s) => ({
      featureFlags: { ...s.featureFlags, [key]: value },
    }));
  return (
    <div className="viewer-toolbar">
      <button onClick={() => setPreset('front')}>Front</button>
      <button onClick={() => setPreset('side')}>Side</button>
      <button onClick={() => setPreset('top')}>Top</button>
      <span className="viewer-toolbar-sep" />
      <button
        className={bloom ? 'toggle on' : 'toggle'}
        onClick={() => setFeatureFlag('bloom', !bloom)}
        title="Bloom postprocessing"
      >
        Bloom
      </button>
      <button
        className={hdr ? 'toggle on' : 'toggle'}
        onClick={() => setFeatureFlag('hdr', !hdr)}
        title="ACES filmic tone mapping"
      >
        HDR
      </button>
    </div>
  );
}

// Shift+drag over the canvas tilts the dome and switches motion source to
// 'manual'. On release, the dome springs back to level. The handler sits on
// the wrap div in the capture phase, `stopPropagation`ing so OrbitControls
// (which listens on the inner <canvas>) never sees these events while we
// own the gesture.
function useShiftDragTilt(wrapRef: React.RefObject<HTMLDivElement>) {
  const patchMotion = useAppStore((s) => s.patchMotionConfig);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let pitch0 = 0;
    let roll0 = 0;
    let pointerId: number | null = null;
    let priorSource = useAppStore.getState().motionConfig.source;

    const onDown = (e: PointerEvent) => {
      if (!e.shiftKey) return;
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      pitch0 = motionController.state.pitch;
      roll0 = motionController.state.roll;
      priorSource = useAppStore.getState().motionConfig.source;
      el.setPointerCapture(e.pointerId);
      motionController.startManualDrag();
      patchMotion({ source: 'manual' });
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      e.stopPropagation();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Drag down → rim tilts forward (away from camera); drag right → rim
      // tilts right. See coordinate-convention comment in structure.ts.
      const pitch = clamp(pitch0 + -dy * DRAG_SENSITIVITY, -DRAG_MAX_RAD, DRAG_MAX_RAD);
      const roll = clamp(roll0 + dx * DRAG_SENSITIVITY, -DRAG_MAX_RAD, DRAG_MAX_RAD);
      motionController.setManualTarget(pitch, roll);
    };

    const onUp = (_e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (pointerId !== null) {
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          /* pointer may already be released (fast flick, cursor out of window) */
        }
        pointerId = null;
      }
      motionController.endManualDrag();
      // Don't clobber a source the user explicitly chose (rocking/playback).
      // If they were in 'idle' before, return to idle; the controller springs
      // back to zero in both idle and manual, so this is cosmetic but keeps
      // the UI dropdown consistent with reality.
      if (priorSource === 'manual' || priorSource === 'idle') {
        patchMotion({ source: 'idle' });
      } else {
        patchMotion({ source: priorSource });
      }
    };

    el.addEventListener('pointerdown', onDown, { capture: true });
    el.addEventListener('pointermove', onMove, { capture: true });
    el.addEventListener('pointerup', onUp, { capture: true });
    el.addEventListener('pointercancel', onUp, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      el.removeEventListener('pointermove', onMove, { capture: true });
      el.removeEventListener('pointerup', onUp, { capture: true });
      el.removeEventListener('pointercancel', onUp, { capture: true });
    };
  }, [wrapRef, patchMotion]);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Bloom + ACES tone mapping. Gated on the `featureFlags.bloom` flag so the
// scene falls back to the plain renderer when disabled — useful for
// side-by-side parity comparisons with the physical LEDs (bloom is a
// display effect, not something the strip actually does).
function ScenePostFx() {
  const bloom = useAppStore((s) => s.featureFlags.bloom);
  const hdr = useAppStore((s) => s.featureFlags.hdr);
  if (!bloom && !hdr) return null;
  return (
    <EffectComposer multisampling={0}>
      {bloom ? (
        <Bloom
          intensity={0.9}
          luminanceThreshold={0.15}
          luminanceSmoothing={0.35}
          mipmapBlur
          radius={0.8}
        />
      ) : (
        <></>
      )}
      {hdr ? <ToneMapping mode={ToneMappingMode.ACES_FILMIC} /> : <></>}
    </EffectComposer>
  );
}

export function Viewer() {
  const wrapRef = useRef<HTMLDivElement>(null);
  useShiftDragTilt(wrapRef);

  return (
    <div className="viewer">
      <Toolbar />
      <div className="viewer-hint">Shift+drag to tilt the dome</div>
      <InspectorHUD />
      <WebcamOverlay />
      <div className="viewer-canvas-wrap" ref={wrapRef}>
        <Canvas
          camera={{ position: [4.5, 0.5, 6.5], fov: 50, near: 0.05, far: 200 }}
          gl={{ antialias: true, alpha: false }}
          dpr={[1, 2]}
        >
          <color attach="background" args={['#000']} />
          <CameraController />
          <Dome />
          <ScenePostFx />
        </Canvas>
      </div>
    </div>
  );
}
