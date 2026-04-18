import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../state/store';
import { buildWledPresetBundle } from '../../core/exporters/wledPreset';
import { bakeTopology } from '../../core/exporters/wledBaked';
import { buildFastLedSketches } from '../../core/exporters/arduinoFastled';
import { coverageIssues } from '../../core/topology';

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

// Ask the user for a directory via the dialog plugin, then hand the file
// list to the Rust `write_export_files` command. Returns the list of
// written absolute paths, or null if the user cancelled.
async function writeFilesTo(
  files: Array<{ filename: string; content: string }>,
  defaultName: string,
): Promise<string[] | null> {
  const dest = await open({ directory: true, multiple: false, title: `Export ${defaultName}` });
  if (!dest || typeof dest !== 'string') return null;
  return invoke<string[]>('write_export_files', { destDir: dest, files });
}

export function ExportPanel() {
  const topology = useAppStore((s) => s.topology);
  const structure = useAppStore((s) => s.structure);
  const leds = useAppStore((s) => s.leds);
  const cfg = useAppStore((s) => s.colorConfig);
  const activeModule = useAppStore((s) => s.pattern.activeModule);
  const activeName = useAppStore((s) => s.pattern.activeName);

  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(10);
  const [busy, setBusy] = useState(false);

  const issues = coverageIssues(topology, structure);
  const hasWled = topology.controllers.some((c) => c.kind === 'WLED');
  const hasFastLed = topology.controllers.some((c) => c.kind === 'FastLED');
  const canBake = hasWled && !!activeModule;

  const handleError = (e: unknown) => {
    setStatus({ kind: 'error', message: String(e instanceof Error ? e.message : e) });
  };
  const reportWritten = (paths: string[] | null, label: string) => {
    if (paths === null) return;
    setStatus({
      kind: 'success',
      message: `${label}: wrote ${paths.length} file${paths.length === 1 ? '' : 's'}`,
    });
  };

  const exportWledPresets = async () => {
    setBusy(true);
    try {
      const bundle = buildWledPresetBundle(topology, cfg);
      const files = bundle.map((f) => ({ filename: f.filename, content: f.json }));
      const paths = await writeFilesTo(files, 'WLED presets');
      reportWritten(paths, 'WLED presets');
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const exportWledBaked = async () => {
    if (!activeModule) return;
    setBusy(true);
    try {
      const bundle = bakeTopology(activeModule, structure, leds, topology, cfg, {
        fps,
        durationSec: duration,
        patternName: activeName ?? 'unnamed',
      });
      const files = bundle.map((f) => ({ filename: f.filename, content: f.json }));
      const paths = await writeFilesTo(files, 'WLED baked');
      reportWritten(paths, 'WLED baked');
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const exportFastLed = async () => {
    setBusy(true);
    try {
      const bundle = buildFastLedSketches(topology, cfg);
      if (bundle.length === 0) {
        setStatus({ kind: 'error', message: 'No FastLED controllers in topology.' });
        return;
      }
      const files = bundle.map((f) => ({ filename: f.filename, content: f.code }));
      const paths = await writeFilesTo(files, 'FastLED sketches');
      reportWritten(paths, 'FastLED sketches');
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel-section export-panel">
      <h2>Export</h2>

      {issues.length > 0 && (
        <p className="export-warning">
          ⚠ Coverage issues present — exports still work but may skip LEDs or double-address
          them. Resolve in the Controllers panel above.
        </p>
      )}

      <h3>WLED preset</h3>
      <p className="export-desc">
        One segment-config JSON per WLED controller. Upload via WLED's preset editor or
        POST to <code>/json/state</code>.
      </p>
      <button
        type="button"
        disabled={!hasWled || busy}
        onClick={exportWledPresets}
        className="export-btn"
      >
        Export WLED presets
      </button>

      <h3>WLED baked</h3>
      <p className="export-desc">
        Pre-renders the active pattern and emits frame bytes per controller for a streaming
        player. Motion/audio are held at zero during bake.
      </p>
      <div className="field">
        <span>FPS</span>
        <input
          type="number"
          min="1"
          max="120"
          step="1"
          value={fps}
          onChange={(e) => setFps(Math.max(1, Number(e.target.value) | 0))}
        />
      </div>
      <div className="field">
        <span>Duration (s)</span>
        <input
          type="number"
          min="0.1"
          max="600"
          step="0.1"
          value={duration}
          onChange={(e) => setDuration(Math.max(0.1, Number(e.target.value)))}
        />
      </div>
      <button
        type="button"
        disabled={!canBake || busy}
        onClick={exportWledBaked}
        className="export-btn"
        title={
          !activeModule
            ? 'Load a pattern first'
            : !hasWled
              ? 'Add a WLED controller first'
              : ''
        }
      >
        Bake & export ({Math.round(fps * duration)} frames)
      </button>

      <h3>FastLED sketch</h3>
      <p className="export-desc">
        One <code>.ino</code> per FastLED controller with topology, gamma LUT, and a
        placeholder rainbow loop to verify wiring.
      </p>
      <button
        type="button"
        disabled={!hasFastLed || busy}
        onClick={exportFastLed}
        className="export-btn"
      >
        Export FastLED sketches
      </button>

      {status.kind !== 'idle' && (
        <div className={`export-status export-status-${status.kind}`}>{status.message}</div>
      )}
    </section>
  );
}
