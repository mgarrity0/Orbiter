import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import {
  Controller,
  ControllerKind,
  ControllerOutput,
  coverageIssues,
  defaultTopology,
  newId,
  totalOutputLeds,
} from '../../core/topology';
import { totalLedCount } from '../../core/structure';

const KINDS: ControllerKind[] = ['WLED', 'FastLED'];

export function ControllersPanel() {
  const structure = useAppStore((s) => s.structure);
  const topology = useAppStore((s) => s.topology);
  const setTopology = useAppStore((s) => s.setTopology);

  const total = totalLedCount(structure);
  const issues = useMemo(() => coverageIssues(topology, structure), [topology, structure]);

  const patchController = (ctrlId: string, patch: Partial<Controller>) => {
    setTopology({
      controllers: topology.controllers.map((c) =>
        c.id === ctrlId ? { ...c, ...patch } : c,
      ),
    });
  };

  const patchOutput = (
    ctrlId: string,
    outId: string,
    patch: Partial<ControllerOutput>,
  ) => {
    setTopology({
      controllers: topology.controllers.map((c) =>
        c.id === ctrlId
          ? {
              ...c,
              outputs: c.outputs.map((o) => (o.id === outId ? { ...o, ...patch } : o)),
            }
          : c,
      ),
    });
  };

  const addController = () => {
    setTopology({
      controllers: [
        ...topology.controllers,
        {
          id: newId('ctrl'),
          name: `WLED-${topology.controllers.length + 1}`,
          kind: 'WLED',
          host: '',
          outputs: [
            { id: newId('out'), pin: 2, ledStart: 0, ledCount: 0, label: 'output-1' },
          ],
        },
      ],
    });
  };

  const removeController = (ctrlId: string) => {
    setTopology({
      controllers: topology.controllers.filter((c) => c.id !== ctrlId),
    });
  };

  const addOutput = (ctrlId: string) => {
    setTopology({
      controllers: topology.controllers.map((c) =>
        c.id === ctrlId
          ? {
              ...c,
              outputs: [
                ...c.outputs,
                {
                  id: newId('out'),
                  pin: 2,
                  ledStart: 0,
                  ledCount: 0,
                  label: `output-${c.outputs.length + 1}`,
                },
              ],
            }
          : c,
      ),
    });
  };

  const removeOutput = (ctrlId: string, outId: string) => {
    setTopology({
      controllers: topology.controllers.map((c) =>
        c.id === ctrlId ? { ...c, outputs: c.outputs.filter((o) => o.id !== outId) } : c,
      ),
    });
  };

  const autoAssign = () => {
    setTopology(defaultTopology(structure));
  };

  return (
    <section className="panel-section controllers-panel">
      <h2>Controllers</h2>
      <div className="controllers-actions">
        <button type="button" onClick={autoAssign} title="One controller per ring">
          Auto-assign
        </button>
        <button type="button" onClick={addController}>
          + Controller
        </button>
      </div>

      {topology.controllers.length === 0 && (
        <p className="library-empty">
          No controllers. Click <code>Auto-assign</code> to generate one per ring, or{' '}
          <code>+ Controller</code> to start from scratch.
        </p>
      )}

      {topology.controllers.map((c) => (
        <div key={c.id} className="controller-card">
          <div className="controller-head">
            <input
              type="text"
              className="controller-name"
              value={c.name}
              onChange={(e) => patchController(c.id, { name: e.target.value })}
            />
            <button
              type="button"
              className="controller-remove"
              title="Remove controller"
              onClick={() => removeController(c.id)}
            >
              ×
            </button>
          </div>
          <label className="field">
            <span>Kind</span>
            <select
              value={c.kind}
              onChange={(e) => patchController(c.id, { kind: e.target.value as ControllerKind })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Host</span>
            <input
              type="text"
              value={c.host}
              placeholder={c.kind === 'WLED' ? 'wled-1.local' : '(serial)'}
              onChange={(e) => patchController(c.id, { host: e.target.value })}
            />
          </label>

          <table className="outputs-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Pin</th>
                <th>Start</th>
                <th>Count</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {c.outputs.map((o) => (
                <tr key={o.id}>
                  <td>
                    <input
                      type="text"
                      value={o.label}
                      onChange={(e) => patchOutput(c.id, o.id, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="48"
                      value={o.pin}
                      onChange={(e) =>
                        patchOutput(c.id, o.id, { pin: Number(e.target.value) | 0 })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max={total}
                      value={o.ledStart}
                      onChange={(e) =>
                        patchOutput(c.id, o.id, { ledStart: Number(e.target.value) | 0 })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max={total}
                      value={o.ledCount}
                      onChange={(e) =>
                        patchOutput(c.id, o.id, { ledCount: Number(e.target.value) | 0 })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      title="Remove output"
                      onClick={() => removeOutput(c.id, o.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="add-output-btn" onClick={() => addOutput(c.id)}>
            + Output
          </button>
        </div>
      ))}

      <div className="stat-line">
        Addressed: <strong>{totalOutputLeds(topology).toLocaleString()}</strong> / {total.toLocaleString()}
      </div>

      {issues.length > 0 && (
        <ul className="coverage-issues">
          {issues.map((iss, i) => (
            <li key={i} className={`issue issue-${iss.kind}`}>
              {renderIssue(iss)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function renderIssue(iss: ReturnType<typeof coverageIssues>[number]): string {
  switch (iss.kind) {
    case 'gap':
      return `Gap: LEDs ${iss.from}–${iss.to - 1} have no controller`;
    case 'overlap':
      return `Overlap: ${iss.aCtrl}/${iss.aOut} ↔ ${iss.bCtrl}/${iss.bOut}`;
    case 'overflow':
      return `Overflow: ${iss.extraLeds} outputs past end of LED list`;
  }
}
