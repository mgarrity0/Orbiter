// Shared numeric-input sanitizers.
//
// HTML `<input type="number" min max>` only constrains the spinner buttons —
// typed text (including "-5" or "1e99") still reaches onChange unclamped, so
// every panel funnels user input through these instead of trusting the DOM.

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Parse + truncate + clamp an integer field. Returns `fallback` (typically
// the current value) when the text doesn't parse, so a half-typed entry
// never feeds the store. The explicit empty check matters: Number('') is 0,
// not NaN, so without it clearing a field would instantly commit the
// field's minimum — destructive when the store reacts to the edit (LED
// rebuilds, topology reconciliation).
export function clampInt(value: string, lo: number, hi: number, fallback: number): number {
  if (value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.trunc(n), lo, hi);
}

export function clampFloat(value: string, lo: number, hi: number, fallback: number): number {
  if (value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, lo, hi);
}
