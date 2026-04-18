// Controller topology — how physical LED controllers map onto the global
// flat LED list.
//
// The global LED list (see structure.ts buildLeds) is a flat array of LEDs
// in fixed order: ring 0 first, then ring 1, etc. Physical controllers
// each drive one or more GPIO outputs; each output pushes a contiguous
// chunk of the chain.
//
// For the exporters, the authoritative thing is: for each output, the
// `[ledStart, ledStart+ledCount)` slice of the global LED list. The
// controller's `kind`, `host`, and `name` are metadata the exporters use to
// emit WLED preset JSON or FastLED sketch code.

import type { Structure } from './structure';
import { totalLedCount } from './structure';

export type ControllerKind = 'WLED' | 'FastLED';

export type ControllerOutput = {
  id: string;
  pin: number;         // GPIO pin number (documentation; exporter emits it)
  ledStart: number;    // inclusive
  ledCount: number;    // exclusive end = ledStart + ledCount
  label: string;       // human hint ("ring-1", "rim", …)
};

export type Controller = {
  id: string;
  name: string;
  kind: ControllerKind;
  host: string;        // IP or mDNS name — blank for FastLED (serial / direct)
  outputs: ControllerOutput[];
};

export type Topology = {
  controllers: Controller[];
};

// One controller per ring — a common starting point for a multi-board
// install. For single-controller installs the user will collapse this
// down. `startingPin` defaults to the typical WLED pinout (GPIO 2 = Data).
export function defaultTopology(structure: Structure): Topology {
  let offset = 0;
  const controllers: Controller[] = structure.rings.map((ring, i) => {
    const output: ControllerOutput = {
      id: `${i}-0`,
      pin: 2,
      ledStart: offset,
      ledCount: ring.ledCount,
      label: `ring-${i + 1}`,
    };
    offset += ring.ledCount;
    return {
      id: `ctrl-${i}`,
      name: `WLED-${i + 1}`,
      kind: 'WLED',
      host: `wled-${i + 1}.local`,
      outputs: [output],
    };
  });
  return { controllers };
}

export function totalOutputLeds(t: Topology): number {
  let n = 0;
  for (const c of t.controllers) {
    for (const o of c.outputs) n += o.ledCount;
  }
  return n;
}

export type CoverageIssue =
  | { kind: 'overlap'; aCtrl: string; aOut: string; bCtrl: string; bOut: string }
  | { kind: 'gap'; from: number; to: number }
  | { kind: 'overflow'; extraLeds: number };

// Walk outputs in address order and report overlaps, gaps, or LEDs past
// the end of the global list. The UI surfaces these as warnings.
export function coverageIssues(t: Topology, structure: Structure): CoverageIssue[] {
  const total = totalLedCount(structure);
  const ranges: { ctrl: string; out: string; start: number; end: number }[] = [];
  for (const c of t.controllers) {
    for (const o of c.outputs) {
      ranges.push({ ctrl: c.id, out: o.id, start: o.ledStart, end: o.ledStart + o.ledCount });
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  const issues: CoverageIssue[] = [];
  let cursor = 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.start > cursor) {
      issues.push({ kind: 'gap', from: cursor, to: r.start });
    }
    if (i > 0 && r.start < ranges[i - 1].end) {
      const prev = ranges[i - 1];
      issues.push({
        kind: 'overlap',
        aCtrl: prev.ctrl,
        aOut: prev.out,
        bCtrl: r.ctrl,
        bOut: r.out,
      });
    }
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < total) {
    issues.push({ kind: 'gap', from: cursor, to: total });
  } else if (cursor > total) {
    issues.push({ kind: 'overflow', extraLeds: cursor - total });
  }
  return issues;
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
