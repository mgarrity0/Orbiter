import { useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import {
  getProjectRoot,
  listPatterns,
  loadPattern,
  onPatternsChanged,
  patternsDirFor,
  startWatching,
} from '../../core/patternRuntime';

// Window between a file-change event and the reload. Editors (VS Code, vim)
// often write through temp files which triggers several notify events in a
// burst; debouncing avoids repeated reloads mid-save.
const RELOAD_DEBOUNCE_MS = 120;

export function LibraryPanel() {
  const available = useAppStore((s) => s.pattern.available);
  const activeName = useAppStore((s) => s.pattern.activeName);
  const error = useAppStore((s) => s.pattern.error);
  const setAvailable = useAppStore((s) => s.setAvailablePatterns);
  const setActive = useAppStore((s) => s.setActivePattern);
  const setError = useAppStore((s) => s.setPatternError);

  // Hold a ref to the latest active name so the watcher callback always sees
  // the current selection without re-binding the listener.
  const activeRef = useRef<string | null>(activeName);
  useEffect(() => {
    activeRef.current = activeName;
  }, [activeName]);

  // Boot: discover patterns, start file watcher, wire the reload handler.
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    let reloadTimer: number | undefined;

    (async () => {
      try {
        const root = await getProjectRoot();
        if (cancelled) return;
        const names = await listPatterns();
        if (cancelled) return;
        setAvailable(names);

        await startWatching(patternsDirFor(root));
        if (cancelled) return;

        unlistenFn = await onPatternsChanged(() => {
          if (reloadTimer) window.clearTimeout(reloadTimer);
          reloadTimer = window.setTimeout(async () => {
            const refreshed = await listPatterns();
            setAvailable(refreshed);
            const current = activeRef.current;
            if (current && refreshed.includes(current)) {
              const res = await loadPattern(current);
              if (res.ok) {
                setActive(current, res.module);
              } else {
                setError(res.error);
              }
            } else if (current && !refreshed.includes(current)) {
              // Active file was deleted — clear selection.
              setActive(null, null);
            }
          }, RELOAD_DEBOUNCE_MS);
        });
      } catch (e) {
        setError(`library init: ${String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
      if (reloadTimer) window.clearTimeout(reloadTimer);
      if (unlistenFn) unlistenFn();
    };
  }, [setAvailable, setActive, setError]);

  const selectPattern = async (name: string) => {
    const res = await loadPattern(name);
    if (res.ok) {
      setActive(name, res.module);
    } else {
      setActive(name, null);
      setError(res.error);
    }
  };

  const stopPattern = () => {
    setActive(null, null);
  };

  return (
    <aside className="panel library-panel">
      <h2>Library</h2>
      {available.length === 0 ? (
        <div className="library-empty">
          No patterns yet. Drop a <code>.js</code> file into the{' '}
          <code>patterns/</code> folder at the project root.
        </div>
      ) : (
        <ul className="library-list">
          {available.map((name) => (
            <li
              key={name}
              className={name === activeName ? 'active' : ''}
              onClick={() => selectPattern(name)}
              title={name}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
      {activeName && (
        <button
          type="button"
          className="library-stop"
          onClick={stopPattern}
          title="Stop pattern and blank the dome"
        >
          Stop
        </button>
      )}
      {error && <div className="library-error">{error}</div>}
    </aside>
  );
}
