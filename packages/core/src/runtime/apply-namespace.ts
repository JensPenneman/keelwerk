import type { ControlStore } from '../control/control-store.ts';
import type { EpochBump } from '../control/epoch-bump.ts';
import { recordScopeMarks } from '../control/record-scope-marks.ts';
import type { Logger } from '../observability/logger.ts';
import type { ScopeCounters } from '../storage/scope-counters.ts';
import type { DecidedNamespace } from './decide-namespace.ts';

/** Counters raised per writing unit of a bump. */
const raiseBatch = 100;

/**
 * Carries out what `decideNamespace` decided for one namespace: each bumped scope moves to its new
 * epoch in the control store (the mark's compare-and-set, logged at warn) and has its counters
 * raised past everything seen, then the namespace's identity (when it differs from the recorded
 * one) and the marks of every scope are recorded, so a first start records without bumping and no
 * position is taken from a rewound counter. The mark's epoch moves first: a crash before the
 * counters are raised is found again as a counter whose epoch lies below its mark and bumps once
 * more. Answers the bumps made, with the epoch each scope ended at.
 */
export async function applyNamespace(input: {
  readonly control: ControlStore;
  readonly decision: DecidedNamespace;
  readonly now: Temporal.Instant;
  readonly log: Logger;
}): Promise<readonly EpochBump[]> {
  const { control, decision, now, log } = input;
  const { source, recorded, current } = decision;
  const { namespace, handle } = source;
  const bumps: EpochBump[] = [];
  const raising: ScopeCounters[] = [];
  for (const { bump, mark, raise } of decision.decided) {
    const stored = await control.marks.bump(mark, bump.from);
    raising.push(stored === mark.epoch ? raise : { ...raise, epoch: stored });
    bumps.push({ ...bump, to: stored });
    log.warn('a restore was detected: the scope moves to a new epoch', {
      scope: bump.scopeId,
      namespace: namespace.id,
      from: bump.from,
      to: stored,
      reason: bump.reason,
    });
  }
  for (let at = 0; at < raising.length; at += raiseBatch) {
    const batch = raising.slice(at, at + raiseBatch);
    await handle.adapter.unit(
      namespace,
      { level: 'namespace', reason: 'restore' },
      async (unit) => {
        for (const row of batch) await unit.counters?.raise(row);
      },
    );
  }
  if (
    recorded === undefined ||
    recorded.systemId !== current.systemId ||
    recorded.timeline !== current.timeline
  ) {
    await control.identities.record({
      namespaceId: namespace.id,
      systemId: current.systemId,
      timeline: current.timeline,
      recordedAt: now,
    });
  }
  await recordScopeMarks(control, source, { now });
  return bumps;
}
