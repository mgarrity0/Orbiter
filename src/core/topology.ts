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

import type { Chipset, Structure } from './structure';
import { buildStrips, totalLedCount } from './structure';

export type ControllerKind = 'WLED' | 'FastLED';

export type ControllerOutput = {
  id: string;
  pin: number;         // GPIO pin number (documentation; exporter emits it)
  ledStart: number;    // inclusive
  ledCount: number;    // exclusive end = ledStart + ledCount
  label: string;       // human hint ("rib-1", "dots-1", …)
  chipset: Chipset;    // what's physically on this output — exporters emit it
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

// One controller per physical strip group — a common starting point for a
// multi-board install. In ring mode that's one controller per ring. In rib
// mode each rib's controller drives the channel strip on GPIO 2 and (when
// holes are configured) that rib's hole-LED chain on GPIO 4 — the wiring
// you'd actually run, since both live on the same board. For single-
// controller installs the user will collapse this down.
export function defaultTopology(structure: Structure): Topology {
  const strips = buildStrips(structure);

  if (structure.layout === 'ribs') {
    const channels = strips.filter((s) => s.kind === 'channel');
    const points = strips.filter((s) => s.kind === 'points');
    const controllers: Controller[] = channels.map((strip, i) => {
      const outputs: ControllerOutput[] = [
        {
          id: `${i}-0`,
          pin: 2,
          ledStart: strip.startIndex,
          ledCount: strip.ledCount,
          label: `rib-${i + 1}`,
          chipset: strip.chipset,
        },
      ];
      const dots = points[i]; // buildStrips emits hole strips in rib order
      if (dots && dots.ledCount > 0) {
        outputs.push({
          id: `${i}-1`,
          pin: 4,
          ledStart: dots.startIndex,
          ledCount: dots.ledCount,
          label: `dots-${i + 1}`,
          chipset: dots.chipset,
        });
      }
      return {
        id: `ctrl-${i}`,
        name: `WLED-${i + 1}`,
        kind: 'WLED' as const,
        host: `wled-${i + 1}.local`,
        outputs,
      };
    });
    return { controllers };
  }

  const controllers: Controller[] = strips.map((strip, i) => ({
    id: `ctrl-${i}`,
    name: `WLED-${i + 1}`,
    kind: 'WLED' as const,
    host: `wled-${i + 1}.local`,
    outputs: [
      {
        id: `${i}-0`,
        pin: 2,
        ledStart: strip.startIndex,
        ledCount: strip.ledCount,
        label: `ring-${i + 1}`,
        chipset: strip.chipset,
      },
    ],
  }));
  return { controllers };
}

// True when `t` still has the address shape defaultTopology(s) would
// generate: same controller/output counts, same ranges, labels, and
// chipsets. Fields that reconcileTopology preserves anyway (name, host,
// kind, pin) are deliberately ignored — editing those doesn't make a
// topology "custom" for reconciliation purposes. The store uses this to
// decide whether a structure edit may auto-regenerate the topology: an
// untouched default tracks the structure silently, while a hand-built
// topology is never clobbered (stale ranges surface as coverage warnings
// and the user re-syncs via Auto-assign).
export function topologyMatchesAutoShape(t: Topology, s: Structure): boolean {
  const auto = defaultTopology(s);
  if (t.controllers.length !== auto.controllers.length) return false;
  return t.controllers.every((c, i) => {
    const ac = auto.controllers[i];
    if (c.outputs.length !== ac.outputs.length) return false;
    return c.outputs.every((o, j) => {
      const ao = ac.outputs[j];
      return (
        o.ledStart === ao.ledStart &&
        o.ledCount === ao.ledCount &&
        o.label === ao.label &&
        o.chipset === ao.chipset
      );
    });
  });
}

// Regenerate output address ranges from the (changed) structure while
// preserving the user's controller identity by position: names, hosts,
// kinds, and pins survive a geometry edit; the start/count ranges — which
// are the part that goes stale — are rebuilt. Callers must gate this on
// topologyMatchesAutoShape — applied to a hand-customized topology it
// would silently discard controllers, splits, labels, and chipset edits.
export function reconcileTopology(old: Topology, structure: Structure): Topology {
  const fresh = defaultTopology(structure);
  return {
    controllers: fresh.controllers.map((c, i) => {
      const prev = old.controllers[i];
      if (!prev) return c;
      return {
        ...c,
        id: prev.id,
        name: prev.name,
        kind: prev.kind,
        host: prev.host,
        outputs: c.outputs.map((o, j) => ({
          ...o,
          pin: prev.outputs[j]?.pin ?? o.pin,
        })),
      };
    }),
  };
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
//
// Overlap detection uses a sweep-line style check against an active set,
// not a pairwise "compare to previous sorted range" — otherwise an earlier
// wide range A that covers a later narrow range C can hide that overlap
// when an intermediate range B sorts between them.
export function coverageIssues(t: Topology, structure: Structure): CoverageIssue[] {
  const total = totalLedCount(structure);
  type Range = { ctrl: string; out: string; start: number; end: number };
  const ranges: Range[] = [];
  for (const c of t.controllers) {
    for (const o of c.outputs) {
      if (o.ledCount <= 0) continue;
      ranges.push({ ctrl: c.id, out: o.id, start: o.ledStart, end: o.ledStart + o.ledCount });
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  const issues: CoverageIssue[] = [];
  // Active set: ranges whose `end` is still in the future relative to the
  // current scan position. We purge ended ranges on each step so the check
  // is O(n log n) overall for normal topologies (a few dozen outputs at
  // most); a Set is fine.
  const active: Range[] = [];
  const reported = new Set<string>(); // dedupe overlap pairs
  let cursor = 0;
  for (const r of ranges) {
    // Evict ranges that ended before this one started.
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end <= r.start) active.splice(i, 1);
    }
    // Any still-active range overlaps `r`.
    for (const a of active) {
      const key = a.start < r.start ? `${a.ctrl}/${a.out}|${r.ctrl}/${r.out}` : `${r.ctrl}/${r.out}|${a.ctrl}/${a.out}`;
      if (reported.has(key)) continue;
      reported.add(key);
      issues.push({
        kind: 'overlap',
        aCtrl: a.ctrl,
        aOut: a.out,
        bCtrl: r.ctrl,
        bOut: r.out,
      });
    }
    active.push(r);

    if (r.start > cursor) {
      issues.push({ kind: 'gap', from: cursor, to: r.start });
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
