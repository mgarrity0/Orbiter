import { Viewer } from './components/Viewer';
import { StructurePanel } from './components/Structure';
import { LibraryPanel } from './components/Library';
import { MotionPanel } from './components/Motion';
import { AudioPanel } from './components/Audio';
import { ControllersPanel } from './components/Controllers';
import { ExportPanel } from './components/Export';
import { ProjectPanel } from './components/Project';
import './App.css';

export default function App() {
  return (
    <main className="app-root">
      <header className="app-header">
        <h1>Orbiter</h1>
        <span className="app-subtitle">LED dome simulator &amp; pattern authoring</span>
        <span className="app-phase">Phase 5 — diffusion + project save/load</span>
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
          <ExportPanel />
        </aside>
      </section>
    </main>
  );
}
