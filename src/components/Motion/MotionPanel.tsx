import { useEffect, useState } from 'react';
import { useAppStore } from '../../state/store';
import { motionController, MotionSource, RockingAxis } from '../../core/motion';

const SOURCES: { value: MotionSource; label: string }[] = [
  { value: 'idle', label: 'Idle' },
  { value: 'manual', label: 'Manual (shift+drag)' },
  { value: 'rocking', label: 'Rocking' },
  { value: 'playback', label: 'Playback' },
];

const AXES: { value: RockingAxis; label: string }[] = [
  { value: 'pitch', label: 'Pitch' },
  { value: 'roll', label: 'Roll' },
  { value: 'both', label: 'Both' },
];

export function MotionPanel() {
  const cfg = useAppStore((s) => s.motionConfig);
  const patchMotion = useAppStore((s) => s.patchMotionConfig);
  const patchRocking = useAppStore((s) => s.patchRocking);

  // Poll the controller for UI-only state (recording length) since we don't
  // push it through zustand on the hot path.
  const [recLen, setRecLen] = useState(0);
  const [isRec, setIsRec] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      setRecLen(motionController.recording.length);
      setIsRec(motionController.isRecording);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const toggleRecord = () => {
    if (motionController.isRecording) {
      motionController.stopRecording();
    } else {
      motionController.startRecording();
    }
  };

  const clearRecord = () => {
    motionController.clearRecording();
    if (cfg.source === 'playback') {
      patchMotion({ source: 'idle' });
    }
  };

  const playRecord = () => {
    motionController.playbackIdx = 0;
    patchMotion({ source: 'playback' });
  };

  return (
    <section className="panel-section">
      <h2>Motion</h2>
      <label className="field">
        <span>Source</span>
        <select
          value={cfg.source}
          onChange={(e) => patchMotion({ source: e.target.value as MotionSource })}
        >
          {SOURCES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <h3>Rocking</h3>
      <label className="field">
        <span>Axis</span>
        <select
          value={cfg.rocking.axis}
          onChange={(e) => patchRocking({ axis: e.target.value as RockingAxis })}
        >
          {AXES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Amplitude (°)</span>
        <input
          type="number"
          step="0.5"
          min="0"
          max="60"
          value={cfg.rocking.amplitudeDeg}
          onChange={(e) => patchRocking({ amplitudeDeg: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>Frequency (Hz)</span>
        <input
          type="number"
          step="0.05"
          min="0.05"
          max="4"
          value={cfg.rocking.frequencyHz}
          onChange={(e) => patchRocking({ frequencyHz: Number(e.target.value) })}
        />
      </label>

      <h3>Recording</h3>
      <div className="motion-record-row">
        <button type="button" onClick={toggleRecord}>
          {isRec ? 'Stop rec' : 'Record'}
        </button>
        <button
          type="button"
          onClick={playRecord}
          disabled={recLen === 0}
          title={recLen === 0 ? 'Record something first' : 'Loop the recording'}
        >
          Play
        </button>
        <button type="button" onClick={clearRecord} disabled={recLen === 0}>
          Clear
        </button>
      </div>
      <div className="motion-record-stat">
        {recLen === 0
          ? 'No recording'
          : `${recLen.toLocaleString()} frames (~${(recLen / 60).toFixed(1)}s @ 60fps)`}
        {isRec && <span className="motion-rec-dot" title="Recording">●</span>}
      </div>
    </section>
  );
}
