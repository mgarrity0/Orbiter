// Mic input + FFT bins for audio-reactive patterns.
//
// We use the browser's getUserMedia + AnalyserNode. Data flows:
//   stream -> MediaStreamAudioSourceNode -> AnalyserNode (fftSize=512)
//   -> every frame: getByteFrequencyData() -> normalize to [0,1] -> bins
//
// `bins` is a Float32Array of length fftSize/2 with each value in [0,1].
// The analyser's own `smoothingTimeConstant` handles the per-bin EMA, so we
// don't do extra smoothing here — patterns that want more can integrate.
//
// Like motionController, this is a module-level mutable singleton the render
// loop reads directly. UI state (whether the mic is enabled) lives in the
// zustand store.

const FFT_SIZE = 512;
const BIN_COUNT = FFT_SIZE / 2;

export type AudioState = {
  enabled: boolean;
  bins: Float32Array;
  energy: number; // mean bin magnitude [0,1]
  low: number;    // mean of bottom third of bins
  mid: number;
  high: number;
};

class AudioEngine implements AudioState {
  enabled = false;
  bins = new Float32Array(BIN_COUNT);
  energy = 0;
  low = 0;
  mid = 0;
  high = 0;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private raw = new Uint8Array(BIN_COUNT);

  async start(): Promise<void> {
    if (this.enabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.72;
      src.connect(analyser);
      this.ctx = ctx;
      this.stream = stream;
      this.analyser = analyser;
      this.enabled = true;
    } catch (e) {
      this.enabled = false;
      throw e;
    }
  }

  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
    }
    if (this.ctx) {
      // Closing the context is async but we don't care when it completes.
      this.ctx.close().catch(() => {});
    }
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.enabled = false;
    this.bins.fill(0);
    this.energy = this.low = this.mid = this.high = 0;
  }

  update(): void {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.raw);
    const n = this.raw.length;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = this.raw[i] / 255;
      this.bins[i] = v;
      sum += v;
    }
    this.energy = sum / n;

    const third = Math.max(1, Math.floor(n / 3));
    let lo = 0;
    let mi = 0;
    let hi = 0;
    for (let i = 0; i < third; i++) lo += this.bins[i];
    for (let i = third; i < 2 * third; i++) mi += this.bins[i];
    for (let i = 2 * third; i < n; i++) hi += this.bins[i];
    this.low = lo / third;
    this.mid = mi / third;
    this.high = hi / Math.max(1, n - 2 * third);
  }
}

export const audioEngine = new AudioEngine();
