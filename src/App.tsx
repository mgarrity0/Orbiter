import { lazy, Suspense, useState } from 'react';
import { Viewer } from './components/Viewer';
import { StructurePanel } from './components/Structure';
import { LibraryPanel } from './components/Library';
import { MotionPanel } from './components/Motion';
import { AudioPanel } from './components/Audio';
import { ControllersPanel } from './components/Controllers';
import { ExportPanel } from './components/Export';
import { ProjectPanel } from './components/Project';
import { CalibrationPanel } from './components/Calibration';
import './App.css';

// Monaco is heavy (~1MB) — only load the editor chunk when the user opens it.
const EditorPanel = lazy(() =>
  import('./components/Editor').then((m) => ({ default: m.EditorPanel })),
);

export default function App() {
  const [editorOpen, setEditorOpen] = useState(false);
  return (
    <main className="app-root">
      <header className="app-header">
        <h1>Orbiter</h1>
        <span className="app-subtitle">LED dome simulator &amp; pattern authoring</span>
        <button
          type="button"
          className="app-editor-btn"
          onClick={() => setEditorOpen(true)}
          title="Open the in-app pattern editor"
        >
          Edit patterns
        </button>
      </header>
      <section className="app-body">
        <LibraryPanel />
        <Viewer />
        <aside className="panel right-panel">
          <ProjectPanel />
          <StructurePanel />
          <MotionPanel />
          <AudioPanel />
          <ControllersPanel />
          <CalibrationPanel />
          <ExportPanel />
        </aside>
      </section>
      {editorOpen && (
        <Suspense fallback={null}>
          <EditorPanel open={editorOpen} onClose={() => setEditorOpen(false)} />
        </Suspense>
      )}
    </main>
  );
}
