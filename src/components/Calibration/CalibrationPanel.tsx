import { useRef } from 'react';
import { useAppStore } from '../../state/store';
import { totalLedCount } from '../../core/structure';
import {
  exportCalibrationFromLeds,
  parseCalibrationFile,
} from '../../core/calibration';

export function CalibrationPanel() {
  const calibration = useAppStore((s) => s.calibration);
  const structure = useAppStore((s) => s.structure);
  const leds = useAppStore((s) => s.leds);
  const setCalibration = useAppStore((s) => s.setCalibration);
  const clearCalibration = useAppStore((s) => s.clearCalibration);
  const setEnabled = useAppStore((s) => s.setCalibrationEnabled);
  const setError = useAppStore((s) => s.setCalibrationError);

  const inputRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const expected = totalLedCount(structure);
      const positions = parseCalibrationFile(raw, expected);
      setCalibration(positions, file.name);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const onImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onImport(f);
    // Clear the input so re-selecting the same file triggers onChange again.
    e.target.value = '';
  };

  const onExportSynthetic = () => {
    const payload = exportCalibrationFromLeds(leds);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calibration-synthetic.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel-section calibration-panel">
      <h2>Calibration</h2>
      <p className="export-desc">
        Replace synthetic sphere positions with captured real-world LED
        coordinates. Expected format:{' '}
        <code>{'{ formatVersion: 1, ledCount, units: "meters", positions: [x,y,z,...] }'}</code>.
        Coordinates are dome-local (apex at y=-r).
      </p>

      <div className="calibration-actions">
        <button type="button" onClick={() => inputRef.current?.click()}>
          Import…
        </button>
        <button
          type="button"
          onClick={onExportSynthetic}
          title="Export current positions (synthetic or captured) as a calibration seed you can edit externally"
        >
          Export current
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        onChange={onImportChange}
        style={{ display: 'none' }}
      />

      <label className="field" style={{ marginTop: 10 }}>
        <span>Use captured</span>
        <input
          type="checkbox"
          checked={calibration.enabled}
          disabled={!calibration.positions}
          onChange={(e) => setEnabled(e.target.checked)}
        />
      </label>

      <div className="stat-line">
        Source:{' '}
        <strong>{calibration.sourceName ?? 'synthetic (none loaded)'}</strong>
        <br />
        Mode: <strong>{calibration.enabled ? 'captured' : 'synthetic'}</strong>
      </div>

      {calibration.positions && (
        <button
          type="button"
          className="export-btn"
          style={{ marginTop: 10 }}
          onClick={clearCalibration}
        >
          Clear capture
        </button>
      )}

      {calibration.error && (
        <div className="export-status export-status-error">{calibration.error}</div>
      )}
    </section>
  );
}
