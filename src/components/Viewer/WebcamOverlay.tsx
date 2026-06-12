import { useEffect, useRef, useState } from 'react';

// Webcam overlay. Useful when comparing the simulator to the physical dome:
// point a camera at the real installation and blend the live feed over the
// 3D canvas so alignment problems (position drift, color temperature) pop
// out visually.
//
// The video is absolute-positioned over the canvas with tunable opacity.
// Toggling off stops the tracks so the camera indicator goes away.

export function WebcamOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [opacity, setOpacity] = useState(0.5);
  const [mirror, setMirror] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      return;
    }
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (playErr) {
            // Autoplay policy, codec mismatch, or muted-media edge cases
            // can reject play(). Surface it instead of silently swallowing
            // — the webcam indicator would be on with no visible feed.
            setError(`play: ${String(playErr instanceof Error ? playErr.message : playErr)}`);
          }
        }
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
        setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return (
    <>
      {enabled && (
        <video
          ref={videoRef}
          className="webcam-video"
          style={{
            opacity,
            transform: mirror ? 'scaleX(-1)' : 'none',
          }}
          playsInline
          muted
        />
      )}
      <div className="webcam-controls">
        <button
          type="button"
          className={enabled ? 'toggle on' : 'toggle'}
          onClick={() => setEnabled((v) => !v)}
          title="Toggle webcam overlay for side-by-side comparison with the physical dome"
        >
          Webcam
        </button>
        {enabled && (
          <>
            <label className="webcam-slider" title="Webcam opacity">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              className={mirror ? 'toggle on' : 'toggle'}
              onClick={() => setMirror((v) => !v)}
              title="Mirror horizontally (useful for selfie-style framing)"
            >
              Mirror
            </button>
          </>
        )}
        {error && <span className="webcam-error">{error}</span>}
      </div>
    </>
  );
}
