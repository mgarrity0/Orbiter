import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { inspector } from '../../core/inspector';
import { clamp } from '../../core/num';

// Floating readout shown while a pixel is hovered. Displays the LED's
// absolute index, ring + per-ring index, dome-local position, and the
// latest pattern byte values (pre-gamma). We poll the render buffer on
// rAF so we don't trigger a zustand re-render every frame.
export function InspectorHUD() {
  const hovered = useAppStore((s) => s.hoveredLedIndex);
  const leds = useAppStore((s) => s.leds);

  const [rgb, setRgb] = useState<[number, number, number]>([0, 0, 0]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (hovered == null) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const tick = () => {
      const buf = inspector.rgbOut;
      if (buf && hovered * 3 + 2 < buf.length) {
        setRgb([buf[hovered * 3 + 0], buf[hovered * 3 + 1], buf[hovered * 3 + 2]]);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [hovered]);

  if (hovered == null || !leds[hovered]) return null;
  const led = leds[hovered];
  const [r, g, b] = rgb;
  // Clamp to 0..255 defensively before formatting: a buggy pattern that
  // writes outside [0,255] would otherwise produce 3+ hex chars per channel
  // and corrupt the swatch color. The underlying buffer is Uint8ClampedArray,
  // but we slurp into a plain tuple for the readout so redo the clamp.
  const byte = (v: number) => clamp(Math.trunc(v), 0, 255);
  const hex = `#${[byte(r), byte(g), byte(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return (
    <div className="inspector-hud">
      <div className="inspector-row">
        <span className="inspector-swatch" style={{ background: hex }} />
        <span className="inspector-hex">{hex.toUpperCase()}</span>
        <span className="inspector-rgb">
          rgb({r}, {g}, {b})
        </span>
      </div>
      <div className="inspector-row inspector-meta">
        <span>
          <strong>#{led.i}</strong>
        </span>
        <span>
          ring {led.ring} · <strong>{led.index}</strong>/{led.ringSize}
        </span>
      </div>
      <div className="inspector-row inspector-meta">
        <span>x {led.x.toFixed(2)}</span>
        <span>y {led.y.toFixed(2)}</span>
        <span>z {led.z.toFixed(2)}</span>
      </div>
    </div>
  );
}
