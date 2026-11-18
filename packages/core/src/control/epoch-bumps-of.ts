import type { ScopeCounters } from '../storage/scope-counters.ts';
import type { EpochBump } from './epoch-bump.ts';
import type { EpochBumpDecision } from './epoch-bump-decision.ts';
import type { NamespaceIdentity } from './namespace-identity.ts';
import type { ScopeMark } from './scope-mark.ts';

/** The greater of two positions; `Math.max` takes numbers, and a position is a bigint. */
function greater(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/**
 * The target epoch of a bump: above the mark's, the counter's and the epoch cache's (the highest
 * epoch any mark of the scope holds, in any namespace), and above the first epoch a counter row
 * starts at, so a bump always moves `epochOf`.
 */
function targetOf(
  mark: ScopeMark | undefined,
  counters: ScopeCounters | undefined,
  known: number,
): number {
  return Math.max(mark?.epoch ?? 0, counters?.epoch ?? 1, known, 1) + 1;
}

/** Each serial's greater value of the mark and the counters. */
function serialsOf(
  mark: ScopeMark | undefined,
  counters: ScopeCounters | undefined,
): Record<string, bigint> {
  const serials: Record<string, bigint> = { ...mark?.serials };
  for (const [name, value] of Object.entries(counters?.serials ?? {})) {
    const known = serials[name];
    if (known === undefined || value > known) serials[name] = value;
  }
  return serials;
}

/**
 * The decision of section 14.7.6 (D2 and D3 of WP-111) for one namespace, from what `connect` reads:
 * the identity recorded last time against the cluster's now, each scope's mark against its counters,
 * and the newest anchored position of each scope that lives here. A scope is bumped when
 * - the system id differs from the recorded one (`identity`) or, with the same system id, the
 *   timeline does (`timeline`): every scope that has a mark or a counter row;
 * - its counters lie below its mark: the position, or the epoch (a backup taken before an earlier
 *   bump), only for a scope that has a mark, or its counters' epoch lies above its mark's (the
 *   control store was restored from before an earlier bump, or is a fresh one over a durable
 *   placement), with or without a mark (`counter`);
 * - its head lies below its newest anchor (`anchor`), with or without a mark.
 * Without a recorded identity the first two are not compared (a first start). The answer gives, for
 * each bump, the mark to write (epoch `to`, position and serials raised) and the counters to raise
 * to the same values: the highest of mark, anchor and counters, serial by serial, so the next value
 * handed out lies above everything seen before; the new epoch is what keeps a value that is issued
 * twice apart (tokens, MODSEQ, uidValidity carry it). Pure.
 */
export function epochBumpsOf(input: {
  readonly recorded: NamespaceIdentity | undefined;
  readonly current: { readonly systemId: string; readonly timeline: string };
  readonly namespaceId: string;
  readonly now: Temporal.Instant;
  /** This namespace's marks, by scope id. */
  readonly marks: ReadonlyMap<string, ScopeMark>;
  /** This namespace's counters, by scope id. */
  readonly counters: ReadonlyMap<string, ScopeCounters>;
  /** The newest anchored position of the scopes that live here, by scope id. */
  readonly anchors: ReadonlyMap<string, bigint>;
  /** The epoch cache of the control store (`control.epochs()`), by scope id: the highest epoch any mark holds. */
  readonly epochs: ReadonlyMap<string, number>;
}): readonly EpochBumpDecision[] {
  const { recorded, current } = input;
  const moved: 'identity' | 'timeline' | undefined =
    recorded === undefined
      ? undefined
      : recorded.systemId !== current.systemId
        ? 'identity'
        : recorded.timeline !== current.timeline
          ? 'timeline'
          : undefined;
  const scopeIds = new Set<string>([
    ...input.marks.keys(),
    ...input.counters.keys(),
    ...input.anchors.keys(),
  ]);
  const found: EpochBumpDecision[] = [];
  for (const scopeId of [...scopeIds].sort()) {
    const mark = input.marks.get(scopeId);
    const counters = input.counters.get(scopeId);
    const anchor = input.anchors.get(scopeId);
    const head = counters?.position ?? 0n;
    const counterEpoch = counters?.epoch ?? 1;
    const rewound = mark !== undefined && (head < mark.position || counterEpoch < mark.epoch);
    const ahead = counterEpoch > Math.max(mark?.epoch ?? 0, 1);
    let reason: EpochBump['reason'] | undefined;
    if (moved !== undefined && (mark !== undefined || counters !== undefined)) reason = moved;
    else if (rewound || ahead) reason = 'counter';
    else if (anchor !== undefined && head < anchor) reason = 'anchor';
    if (reason === undefined) continue;
    const to = targetOf(mark, counters, input.epochs.get(scopeId) ?? 0);
    const position = [mark?.position ?? 0n, anchor ?? 0n, head].reduce(greater);
    const serials = serialsOf(mark, counters);
    found.push({
      bump: { scopeId, from: mark?.epoch ?? 0, to, reason },
      mark: {
        scopeId,
        namespaceId: input.namespaceId,
        epoch: to,
        position,
        serials,
        updatedAt: input.now,
      },
      raise: { scopeId, position, epoch: to, serials },
    });
  }
  return found;
}
