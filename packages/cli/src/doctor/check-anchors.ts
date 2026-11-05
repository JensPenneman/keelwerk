import type { AnchorFacts } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/**
 * Chain anchors (section 15.1.8, S-35): a scope whose newest anchor is older than the cadence, a
 * scope whose head is below its newest anchor (rewound, section 14.7.6), and a ledger sink that
 * refused an append.
 */
export function checkAnchors(facts: AnchorFacts, now: Temporal.Instant): readonly DoctorFinding[] {
  const found: DoctorFinding[] = [];
  const check = 'anchors';
  for (const scope of facts.scopes) {
    if (scope.head !== undefined && BigInt(scope.head) < BigInt(scope.anchored)) {
      found.push(
        findingOf(
          check,
          'error',
          scope.scopeId,
          `the head ${scope.head} is below the newest anchor ${scope.anchored}: the database may have been restored from an older backup`,
          'find the restore, then run keelwerk db verify',
        ),
      );
    }
    if (facts.cadenceMs !== undefined) {
      const age = now.epochMilliseconds - Temporal.Instant.from(scope.anchoredAt).epochMilliseconds;
      if (age > facts.cadenceMs) {
        found.push(
          findingOf(
            check,
            'warning',
            scope.scopeId,
            `the newest anchor is ${Math.round(age / 1000)} s old, the cadence is ${Math.round(facts.cadenceMs / 1000)} s`,
            'check that the ledger sink accepts appends and that a process runs the anchoring',
          ),
        );
      }
    }
  }
  for (const sink of facts.refusedSinks) {
    const failure =
      sink.lastFailure === undefined
        ? ''
        : `; the last failure at ${sink.lastFailure.at}: ${sink.lastFailure.message}`;
    found.push(
      findingOf(
        check,
        'error',
        sink.sink,
        `a ledger sink refused ${sink.refusedAppends} append(s)${failure}`,
        'check the sink (disk space, permissions, the path)',
      ),
    );
  }
  return found;
}
