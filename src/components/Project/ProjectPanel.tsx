import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../state/store';
import {
  buildProjectFile,
  parseProjectFile,
  ProjectFile,
  ProjectSnapshot,
} from '../../core/project';
import { loadPattern } from '../../core/patternRuntime';

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'untitled';
}

export function ProjectPanel() {
  const projectName = useAppStore((s) => s.projectName);
  const setProjectName = useAppStore((s) => s.setProjectName);
  const applyProjectFile = useAppStore((s) => s.applyProjectFile);
  const setActivePattern = useAppStore((s) => s.setActivePattern);
  const setPatternError = useAppStore((s) => s.setPatternError);

  const [available, setAvailable] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const names = await invoke<string[]>('list_projects');
      setAvailable(names);
    } catch (e) {
      setStatus({ kind: 'error', message: `list_projects: ${String(e)}` });
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const snapshotFromStore = (): ProjectSnapshot => {
    const s = useAppStore.getState();
    return {
      name: s.projectName,
      structure: s.structure,
      colorConfig: s.colorConfig,
      topology: s.topology,
      motionConfig: s.motionConfig,
      featureFlags: s.featureFlags,
      activePatternName: s.pattern.activeName,
    };
  };

  const doSave = async (name: string) => {
    setBusy(true);
    try {
      const snap = snapshotFromStore();
      snap.name = name;
      const file = buildProjectFile(snap);
      const filename = `${sanitizeFilename(name)}.json`;
      await invoke<string>('write_project', {
        name: filename,
        content: JSON.stringify(file, null, 2),
      });
      setProjectName(name);
      setStatus({ kind: 'success', message: `saved ${filename}` });
      await refreshList();
    } catch (e) {
      setStatus({ kind: 'error', message: `save: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const saveClick = () => doSave(projectName);

  const saveAsClick = () => {
    const next = window.prompt('Save project as:', projectName);
    if (!next) return;
    doSave(next.trim());
  };

  const loadClick = async (filename: string) => {
    setBusy(true);
    try {
      const content = await invoke<string>('read_project', { name: filename });
      const raw = JSON.parse(content);
      const parsed: ProjectFile = parseProjectFile(raw);
      applyProjectFile(parsed);
      // Re-load the active pattern from disk, if any — applyProjectFile
      // only writes the *name*, not the module.
      if (parsed.activePatternName) {
        const res = await loadPattern(parsed.activePatternName);
        if (res.ok) {
          setActivePattern(parsed.activePatternName, res.module);
        } else {
          setActivePattern(parsed.activePatternName, null);
          setPatternError(res.error);
        }
      } else {
        setActivePattern(null, null);
      }
      setStatus({ kind: 'success', message: `loaded ${parsed.name}` });
    } catch (e) {
      setStatus({ kind: 'error', message: `load: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel-section project-panel">
      <h2>Project</h2>
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
      </label>
      <div className="project-actions">
        <button type="button" onClick={saveClick} disabled={busy}>
          Save
        </button>
        <button type="button" onClick={saveAsClick} disabled={busy}>
          Save as…
        </button>
      </div>

      <h3>Saved projects</h3>
      {available.length === 0 ? (
        <p className="library-empty">
          No saved projects. Click <code>Save</code> to create one in{' '}
          <code>projects/</code>.
        </p>
      ) : (
        <ul className="library-list">
          {available.map((name) => (
            <li key={name} title={name} onClick={() => loadClick(name)}>
              {name}
            </li>
          ))}
        </ul>
      )}

      {status.kind !== 'idle' && (
        <div className={`export-status export-status-${status.kind}`}>{status.message}</div>
      )}
    </section>
  );
}
