import { useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { audioEngine } from '../../core/audio';

export function AudioPanel() {
  const requested = useAppStore((s) => s.audio.requested);
  const error = useAppStore((s) => s.audio.error);
  const setRequested = useAppStore((s) => s.setAudioRequested);
  const setError = useAppStore((s) => s.setAudioError);

  // Start/stop the engine in response to the requested flag.
  useEffect(() => {
    let cancelled = false;
    if (requested && !audioEngine.enabled) {
      audioEngine
        .start()
        .catch((e) => {
          if (cancelled) return;
          setError(String(e));
          setRequested(false);
        });
    } else if (!requested && audioEngine.enabled) {
      audioEngine.stop();
    }
    return () => {
      cancelled = true;
    };
  }, [requested, setRequested, setError]);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw the spectrum at ~30 fps — low enough to be cheap but fluid.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 33) return;
      last = t;
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);
      const bins = audioEngine.bins;
      const n = bins.length;
      // Linear bin -> bar. Showing the full range gets noisy at the high
      // end; only draw the first half which covers ~0–12 kHz at 48 kHz sr.
      const show = Math.min(n, 128);
      const bw = w / show;
      for (let i = 0; i < show; i++) {
        const v = bins[i];
        const bh = v * h;
        const hue = 210 - (i / show) * 180;
        ctx.fillStyle = `hsl(${hue}, 70%, 55%)`;
        ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 1), bh);
      }
      // Overlay energy readout.
      ctx.fillStyle = 'rgba(230,230,230,0.75)';
      ctx.font = '10px ui-monospace, monospace';
      const txt = `E ${audioEngine.energy.toFixed(2)}  L ${audioEngine.low.toFixed(
        2,
      )}  M ${audioEngine.mid.toFixed(2)}  H ${audioEngine.high.toFixed(2)}`;
      ctx.fillText(txt, 4, 11);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="panel-section">
      <h2>Audio</h2>
      <div className="audio-toggle-row">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRequested(!requested);
          }}
        >
          {requested ? 'Stop mic' : 'Start mic'}
        </button>
        <span className={`audio-status ${requested ? 'on' : ''}`}>
          {requested ? 'LIVE' : 'OFF'}
        </span>
      </div>
      <canvas ref={canvasRef} width={292} height={90} className="audio-spectrum" />
      {error && <div className="library-error">{error}</div>}
    </section>
  );
}
