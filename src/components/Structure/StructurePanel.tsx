import { useAppStore } from '../../state/store';
import {
  Chipset,
  CHIPSETS,
  Diffusion,
  LedDensity,
  LedLayout,
  Ring,
  RibConfig,
  suggestedLedCount,
  suggestedRibLedCount,
  totalLedCount,
} from '../../core/structure';
import { clampFloat, clampInt } from '../../core/num';

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

  const updateRib = (patch: Partial<RibConfig>) => {
    patchStructure({ rib: { ...structure.rib, ...patch } });
  };
  const updateWave = (patch: Partial<RibConfig['wave']>) => {
    updateRib({ wave: { ...structure.rib.wave, ...patch } });
  };
  const updateHoles = (patch: Partial<RibConfig['holes']>) => {
    updateRib({ holes: { ...structure.rib.holes, ...patch } });
  };

  const resetRibLedCount = () => {
    // Measures the actual wavy channel path, so the suggestion tracks the
    // wave settings, not just the meridian arc.
    const count = suggestedRibLedCount(structure.diameterMeters, structure.rib);
    updateRib({ ledCount: count });
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
          onChange={(e) =>
            patchStructure({
              diameterMeters: clampFloat(e.target.value, 0.5, 20, structure.diameterMeters),
            })
          }
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
          onChange={(e) =>
            patchStructure({
              verticalRibCount: clampInt(e.target.value, 3, 64, structure.verticalRibCount),
            })
          }
        />
      </label>
      <label className="field">
        <span>Frame apex lat°</span>
        <input
          type="number"
          step="0.5"
          min="10"
          max="89"
          value={structure.frameApexLatitudeDeg}
          onChange={(e) =>
            patchStructure({
              frameApexLatitudeDeg: clampFloat(
                e.target.value,
                10,
                89,
                structure.frameApexLatitudeDeg,
              ),
            })
          }
          title="How far toward the bottom apex the structural plywood ribs extend. Frame geometry — independent of the LED layout."
        />
      </label>
      <label className="field">
        <span>Frame top lat°</span>
        <input
          type="number"
          step="0.5"
          min="-89"
          max="89"
          value={structure.frameTopLatitudeDeg}
          onChange={(e) =>
            patchStructure({
              frameTopLatitudeDeg: clampFloat(
                e.target.value,
                -89,
                89,
                structure.frameTopLatitudeDeg,
              ),
            })
          }
          title="How far the drawn ribs climb. 0 stops at the equator; negative rises above it toward the top pole, closing the orb like the physical build."
        />
      </label>
      <label className="field">
        <span>LED layout</span>
        <select
          value={structure.layout}
          onChange={(e) => patchStructure({ layout: e.target.value as LedLayout })}
          title="Rings wrap horizontally at each latitude. Ribs run vertically along meridians from rim to apex."
        >
          <option value="rings">Horizontal (rings)</option>
          <option value="ribs">Vertical (ribs)</option>
        </select>
      </label>

      {structure.layout === 'rings' ? (
        <>
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
                      min="-89"
                      max="89"
                      value={ring.latitudeDeg}
                      onChange={(e) =>
                        updateRing(i, {
                          latitudeDeg: clampFloat(e.target.value, -89, 89, ring.latitudeDeg),
                        })
                      }
                      title="Negative latitudes sit above the equator, toward the top pole."
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="2000"
                      value={ring.ledCount}
                      onChange={(e) =>
                        updateRing(i, {
                          ledCount: clampInt(e.target.value, 1, 2000, ring.ledCount),
                        })
                      }
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
        </>
      ) : (
        <>
          <h3>Rib strip</h3>
          {/* All ribs share one strip spec — the common case is identical
              WS2815 cuts driven by one rib count. Per-rib customization
              (different lengths or diffusions per rib) is out of scope
              for the first cut. */}
          <label className="field">
            <span>LEDs per rib</span>
            <input
              type="number"
              step="1"
              min="1"
              max="2000"
              value={structure.rib.ledCount}
              onChange={(e) =>
                updateRib({
                  ledCount: clampInt(e.target.value, 1, 2000, structure.rib.ledCount),
                })
              }
            />
            <button
              type="button"
              title="Reset LED count from apex latitude + density"
              onClick={resetRibLedCount}
            >
              ↻
            </button>
          </label>
          <label className="field">
            <span>LED/m</span>
            <select
              value={structure.rib.ledDensity}
              onChange={(e) =>
                updateRib({ ledDensity: Number(e.target.value) as LedDensity })
              }
            >
              <option value={30}>30</option>
              <option value={60}>60</option>
            </select>
          </label>
          <label className="field">
            <span>Top lat°</span>
            <input
              type="number"
              step="0.5"
              min="-89"
              max="88"
              value={structure.rib.topLatitudeDeg}
              onChange={(e) =>
                updateRib({
                  topLatitudeDeg: clampFloat(
                    e.target.value,
                    -89,
                    structure.rib.apexLatitudeDeg - 1,
                    structure.rib.topLatitudeDeg,
                  ),
                })
              }
              title="Where the strip starts. 0 = the equator; negative climbs above it toward the top pole, like the build's channels running up and over."
            />
          </label>
          <label className="field">
            <span>Apex lat°</span>
            <input
              type="number"
              step="0.5"
              min="1"
              max="89"
              value={structure.rib.apexLatitudeDeg}
              onChange={(e) =>
                updateRib({
                  apexLatitudeDeg: clampFloat(
                    e.target.value,
                    structure.rib.topLatitudeDeg + 1,
                    89,
                    structure.rib.apexLatitudeDeg,
                  ),
                })
              }
              title="How close to the bottom apex the rib strip terminates (degrees of latitude)."
            />
          </label>
          <label className="field">
            <span>Diffusion</span>
            <select
              value={structure.rib.diffusion}
              onChange={(e) => updateRib({ diffusion: e.target.value as Diffusion })}
            >
              {DIFFUSIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Chipset</span>
            <select
              value={structure.rib.chipset}
              onChange={(e) => updateRib({ chipset: e.target.value as Chipset })}
            >
              {CHIPSETS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <h3>Channel wave</h3>
          {/* The routed squiggle on each rib face. Amplitude 0 = straight
              meridian channel. All ribs share the wave — one CNC template. */}
          <label className="field">
            <span>Amplitude (m)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="0.5"
              value={structure.rib.wave.amplitudeMeters}
              onChange={(e) =>
                updateWave({
                  amplitudeMeters: clampFloat(
                    e.target.value,
                    0,
                    0.5,
                    structure.rib.wave.amplitudeMeters,
                  ),
                })
              }
              title="Radial swing of the routed channel across the rib face. 0 = straight."
            />
          </label>
          <label className="field">
            <span>Cycles</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max="24"
              value={structure.rib.wave.cycles}
              onChange={(e) =>
                updateWave({
                  cycles: clampFloat(e.target.value, 0, 24, structure.rib.wave.cycles),
                })
              }
              title="Full sine periods from rim to channel end."
            />
          </label>

          <h3>Hole dots</h3>
          {/* Drilled holes alongside the channel, one point LED each.
              Count 0 disables them. */}
          <label className="field">
            <span>Dots per rib</span>
            <input
              type="number"
              step="1"
              min="0"
              max="200"
              value={structure.rib.holes.count}
              onChange={(e) =>
                updateHoles({
                  count: clampInt(e.target.value, 0, 200, structure.rib.holes.count),
                })
              }
            />
          </label>
          <label className="field">
            <span>Offset (m)</span>
            <input
              type="number"
              step="0.01"
              min="0.02"
              max="0.5"
              value={structure.rib.holes.offsetMeters}
              onChange={(e) =>
                updateHoles({
                  offsetMeters: clampFloat(
                    e.target.value,
                    0.02,
                    0.5,
                    structure.rib.holes.offsetMeters,
                  ),
                })
              }
              title="Radial distance from the channel path. Dots alternate sides."
            />
          </label>
          <label className="field">
            <span>Dot chipset</span>
            <select
              value={structure.rib.holes.chipset}
              onChange={(e) => updateHoles({ chipset: e.target.value as Chipset })}
            >
              {CHIPSETS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <div className="stat-line">
        Total LEDs: <strong>{totalLedCount(structure).toLocaleString()}</strong>
      </div>
    </section>
  );
}
