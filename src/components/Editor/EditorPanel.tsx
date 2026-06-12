import { useEffect, useRef, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useAppStore } from '../../state/store';
import {
  readPatternSource,
  writePatternSource,
} from '../../core/patternRuntime';
import { nameExistsCaseInsensitive } from '../../core/fileNames';

// Boilerplate used when creating a new pattern from scratch.
const NEW_PATTERN_TEMPLATE = (name: string) => `// ${name} — new pattern.
//
// Write into \`out\` as [r, g, b] bytes (0..255) for each LED. ctx gives you
// the structure, per-LED geometry, motion state, audio bins, and time.

export const meta = {
  name: '${name.replace(/\.[jm]?js$/i, '')}',
  description: 'describe me',
};

export function render(ctx, out) {
  const t = ctx.time;
  for (let i = 0; i < ctx.ledCount; i++) {
    const led = ctx.leds[i];
    const v = 0.5 + 0.5 * Math.sin(led.lat * 4 + t * 1.5);
    out[i * 3 + 0] = 180 * v;
    out[i * 3 + 1] = 80 * v;
    out[i * 3 + 2] = 220 * v;
  }
}
`;

type Props = {
  open: boolean;
  onClose: () => void;
};

export function EditorPanel({ open, onClose }: Props) {
  const available = useAppStore((s) => s.pattern.available);
  const activeName = useAppStore((s) => s.pattern.activeName);

  // Which file the editor is currently showing. Separate from `activeName`
  // because you can edit a pattern without running it (or edit one while a
  // different pattern runs on the dome).
  const [fileName, setFileName] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'saving' }
    | { kind: 'saved'; at: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const dirtyRef = useRef(false);

  // When the panel opens, jump to the active pattern (or the first available).
  useEffect(() => {
    if (!open) return;
    const target = fileName ?? activeName ?? available[0] ?? null;
    if (target && target !== fileName) {
      // Internal call: on-open bootstrap, no dirty state to protect.
      void openFileInternal(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openFileInternal = async (name: string) => {
    setLoading(true);
    setStatus({ kind: 'idle' });
    try {
      const text = await readPatternSource(name);
      setFileName(name);
      setSource(text);
      dirtyRef.current = false;
    } catch (e) {
      setStatus({ kind: 'error', message: `open ${name}: ${String(e)}` });
    } finally {
      setLoading(false);
    }
  };

  // Confirms before discarding unsaved changes so a misclick doesn't nuke
  // minutes of editor work. Returns true when it's safe to proceed.
  const confirmDiscard = () =>
    !dirtyRef.current ||
    window.confirm(
      `Discard unsaved changes to ${fileName ?? 'this pattern'}?`,
    );

  // Public wrapper for user-initiated file switches.
  const openFile = async (name: string) => {
    if (fileName !== name && !confirmDiscard()) return;
    await openFileInternal(name);
  };

  const save = async () => {
    if (!fileName) return;
    setStatus({ kind: 'saving' });
    try {
      await writePatternSource(fileName, source);
      dirtyRef.current = false;
      setStatus({ kind: 'saved', at: Date.now() });
    } catch (e) {
      setStatus({ kind: 'error', message: `save: ${String(e)}` });
    }
  };

  const createNew = async () => {
    if (!confirmDiscard()) return;
    const raw = window.prompt('New pattern filename (e.g. "my-pattern.js")');
    if (!raw) return;
    const name = /\.[jm]?js$/i.test(raw) ? raw : `${raw}.js`;
    if (nameExistsCaseInsensitive(name, available)) {
      setStatus({ kind: 'error', message: `${name} already exists` });
      return;
    }
    const body = NEW_PATTERN_TEMPLATE(name);
    try {
      await writePatternSource(name, body);
      setFileName(name);
      setSource(body);
      dirtyRef.current = false;
      setStatus({ kind: 'saved', at: Date.now() });
      // LibraryPanel's notify listener will pick it up and update the list.
    } catch (e) {
      setStatus({ kind: 'error', message: `create ${name}: ${String(e)}` });
    }
  };

  // Cmd/Ctrl-S inside the editor → save. Registered on mount via the
  // monaco instance so it fires even when the editor has focus.
  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => void save(),
    );
  };

  if (!open) return null;

  const statusLabel =
    status.kind === 'saving'
      ? 'saving…'
      : status.kind === 'saved'
      ? 'saved'
      : status.kind === 'error'
      ? status.message
      : dirtyRef.current
      ? 'modified'
      : '—';

  return (
    <div className="editor-overlay" role="dialog" aria-label="Pattern editor">
      <div className="editor-shell">
        <header className="editor-header">
          <strong className="editor-title">Pattern Editor</strong>
          <select
            className="editor-file-select"
            value={fileName ?? ''}
            onChange={(e) => void openFile(e.target.value)}
            disabled={loading || available.length === 0}
          >
            {available.length === 0 && <option value="">(no patterns yet)</option>}
            {available.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button type="button" onClick={createNew} title="Create a new pattern file">
            New…
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!fileName || status.kind === 'saving'}
            title="Save (Ctrl/Cmd+S)"
          >
            Save
          </button>
          <span
            className={
              'editor-status ' +
              (status.kind === 'error' ? 'is-error' : status.kind === 'saved' ? 'is-ok' : '')
            }
          >
            {statusLabel}
          </span>
          <button
            type="button"
            className="editor-close"
            onClick={() => {
              if (!confirmDiscard()) return;
              onClose();
            }}
            title="Close editor"
          >
            ×
          </button>
        </header>
        <div className="editor-body">
          <Editor
            height="100%"
            theme="vs-dark"
            language="javascript"
            value={source}
            options={{
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              tabSize: 2,
              automaticLayout: true,
            }}
            onChange={(value) => {
              setSource(value ?? '');
              dirtyRef.current = true;
              if (status.kind === 'saved') setStatus({ kind: 'idle' });
            }}
            onMount={onMount}
          />
        </div>
      </div>
    </div>
  );
}
