import { useAppStore } from '../../state/store';
import {
  Diffusion,
  LedDensity,
  Ring,
  suggestedLedCount,
  totalLedCount,
} from '../../core/structure';

const DIFFUSIONS: Diffusion[] = ['bare', 'frosted', 'acrylic-band'];

export function StructurePanel() {
  const structure = useAppStore((s) => s.structure);
  const patchStructure = useAppStore((s) => s.patchStructure);
  const setStructure = useAppStore((s) => s.setStructure);

  const updateRing = (idx: number, patch: Partial<Ring>) => {
    const rings = structure.rings.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setStructure({ ...structure, rings });
  };

  const resetLedCount = (idx: number) => {
    const ring = structure.rings[idx];
    const count = suggestedLedCount(structure.diameterMeters, ring.latitudeDeg, ring.ledDensity);
    updateRing(idx, { ledCount: count });
  };

  return (
    <section className="panel-section structure-panel">
      <h2>Structure</h2>
      <label className="field">
        <span>Diameter (m)</span>
        <input
          type="number"
          step="0.01"
          min="0.5"
          max="20"
          value={structure.diameterMeters}
          onChange={(e) => patchStructure({ diameterMeters: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>Rib count</span>
        <input
          type="number"
          step="1"
          min="3"
          max="64"
          value={structure.verticalRibCount}
          onChange={(e) => patchStructure({ verticalRibCount: Number(e.target.value) | 0 })}
        />
      </label>

      <h3>Rings</h3>
      <table className="rings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Lat°</th>
            <th>LEDs</th>
            <th>LED/m</th>
            <th>Diffusion</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {structure.rings.map((ring, i) => (
            <tr key={ring.id}>
              <td>{i + 1}</td>
              <td>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="89"
                  value={ring.latitudeDeg}
                  onChange={(e) => updateRing(i, { latitudeDeg: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="2000"
                  value={ring.ledCount}
                  onChange={(e) => updateRing(i, { ledCount: Number(e.target.value) | 0 })}
                />
              </td>
              <td>
                <select
                  value={ring.ledDensity}
                  onChange={(e) =>
                    updateRing(i, { ledDensity: Number(e.target.value) as LedDensity })
                  }
                >
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                </select>
              </td>
              <td>
                <select
                  value={ring.diffusion}
                  onChange={(e) => updateRing(i, { diffusion: e.target.value as Diffusion })}
                >
                  {DIFFUSIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  type="button"
                  title="Reset LED count from latitude + density"
                  onClick={() => resetLedCount(i)}
                >
                  ↻
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="stat-line">
        Total LEDs: <strong>{totalLedCount(structure).toLocaleString()}</strong>
      </div>
    </section>
  );
}
