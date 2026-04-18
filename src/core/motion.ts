// Motion / pose source for the dome.
//
// The dome's physical installation swings — it hangs from a frame and tilts
// as people move around it. We simulate that here so patterns can respond
// (e.g. a "tilt-level" pattern that keeps a horizontal band aligned with
// world gravity even when the dome is rocking).
//
// Sources, in priority order:
//   - 'manual'   : follows the mouse-drag target, spring-damped.
//   - 'rocking'  : canned sinusoidal motion on pitch/roll/both.
//   - 'playback' : replays a recorded array of MotionStates at frame rate.
//   - 'idle'     : springs toward zero, no input.
//
// Data held here is mutated in place every frame; the render loop reads
// directly from `motionController.state` to avoid zustand re-renders on the
// hot path. UI sliders live in the zustand store and this controller reads
// them once per frame from there.

import { useAppStore } from '../state/store';

export type MotionState = {
  // Orientation in radians. `pitch` is rotation around the world X axis
  // (tipping front/back), `roll` is rotation around world Z axis (tipping
  // left/right), `yaw` is rotation around world Y axis (spin).
  pitch: number;
  roll: number;
  yaw: number;
  // Angular velocity in rad/s — useful for patterns that trigger on
  // quick motion (flicks, collisions).
  pitchVel: number;
  rollVel: number;
  yawVel: number;
};

export type MotionSource = 'idle' | 'manual' | 'rocking' | 'playback';
export type RockingAxis = 'pitch' | 'roll' | 'both';

export type RockingConfig = {
  amplitudeDeg: number; // peak angle in degrees
  frequencyHz: number;
  axis: RockingAxis;
};

export type MotionConfig = {
  source: MotionSource;
  rocking: RockingConfig;
};

export const defaultMotionConfig: MotionConfig = {
  source: 'idle',
  rocking: { amplitudeDeg: 12, frequencyHz: 0.5, axis: 'pitch' },
};

function zeroState(): MotionState {
  return { pitch: 0, roll: 0, yaw: 0, pitchVel: 0, rollVel: 0, yawVel: 0 };
}

class MotionController {
  state: MotionState = zeroState();

  // Manual source — where the user dragged to. Pitch/roll only.
  manualTarget = { pitch: 0, roll: 0 };
  manualDragging = false;

  // Playback source — recorded frames indexed at frame rate, good enough
  // for the rocking-ish motions we typically record.
  recording: MotionState[] = [];
  isRecording = false;
  playbackIdx = 0;

  startManualDrag() {
    this.manualDragging = true;
  }
  endManualDrag() {
    this.manualDragging = false;
    // Release the target so the dome springs back to level.
    this.manualTarget.pitch = 0;
    this.manualTarget.roll = 0;
  }
  setManualTarget(pitch: number, roll: number) {
    this.manualTarget.pitch = pitch;
    this.manualTarget.roll = roll;
  }

  startRecording() {
    this.recording = [];
    this.isRecording = true;
  }
  stopRecording() {
    this.isRecording = false;
  }
  clearRecording() {
    this.recording = [];
    this.playbackIdx = 0;
  }
  hasRecording(): boolean {
    return this.recording.length > 0;
  }

  update(t: number, dt: number) {
    const cfg = useAppStore.getState().motionConfig;
    const prevPitch = this.state.pitch;
    const prevRoll = this.state.roll;
    const prevYaw = this.state.yaw;

    switch (cfg.source) {
      case 'idle': {
        // Spring back to zero.
        this.springTo(0, 0, dt, 6);
        break;
      }
      case 'manual': {
        // Stiffer spring while the user is actively dragging so the dome
        // tracks the cursor, softer when they let go.
        const k = this.manualDragging ? 22 : 6;
        this.springTo(this.manualTarget.pitch, this.manualTarget.roll, dt, k);
        break;
      }
      case 'rocking': {
        const omega = 2 * Math.PI * cfg.rocking.frequencyHz;
        const amp = (cfg.rocking.amplitudeDeg * Math.PI) / 180;
        if (cfg.rocking.axis === 'pitch' || cfg.rocking.axis === 'both') {
          this.state.pitch = Math.sin(omega * t) * amp;
        } else {
          this.state.pitch *= Math.exp(-4 * dt);
        }
        if (cfg.rocking.axis === 'roll' || cfg.rocking.axis === 'both') {
          this.state.roll = Math.cos(omega * t) * amp;
        } else {
          this.state.roll *= Math.exp(-4 * dt);
        }
        break;
      }
      case 'playback': {
        if (this.recording.length > 0) {
          const f = this.recording[this.playbackIdx % this.recording.length];
          this.state.pitch = f.pitch;
          this.state.roll = f.roll;
          this.state.yaw = f.yaw;
          this.playbackIdx++;
        } else {
          this.state.pitch *= Math.exp(-4 * dt);
          this.state.roll *= Math.exp(-4 * dt);
        }
        break;
      }
    }

    if (dt > 0) {
      this.state.pitchVel = (this.state.pitch - prevPitch) / dt;
      this.state.rollVel = (this.state.roll - prevRoll) / dt;
      this.state.yawVel = (this.state.yaw - prevYaw) / dt;
    }

    if (this.isRecording) {
      this.recording.push({ ...this.state });
    }
  }

  // Exponential-decay approach to a target — not a true critical-damped
  // spring but close enough for this use case and doesn't overshoot.
  private springTo(targetPitch: number, targetRoll: number, dt: number, k: number) {
    const alpha = 1 - Math.exp(-k * dt);
    this.state.pitch += (targetPitch - this.state.pitch) * alpha;
    this.state.roll += (targetRoll - this.state.roll) * alpha;
    this.state.yaw += (0 - this.state.yaw) * alpha;
  }

  reset() {
    this.state = zeroState();
    this.manualTarget.pitch = 0;
    this.manualTarget.roll = 0;
  }
}

export const motionController = new MotionController();
