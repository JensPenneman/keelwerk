import { connect } from './connect.ts';
import type { MeasurementResult } from './measurement-result.ts';
import { medianRow } from './median-row.ts';
import { positionVariants } from './position-variants.ts';
import type { ResultRow } from './result-row.ts';
import { runAppends } from './run-appends.ts';
import type { RunningPostgres } from './running-postgres.ts';
import { seedScopes } from './seed-scopes.ts';
import type { SeededScope } from './seeded-scope.ts';
import { summarizeAppends } from './summarize-appends.ts';

const repetitions = 3;
const variants = [
  'read committed, positioned loads',
  'read committed, positioned, target after lock',
  'repeatable read',
] as const;

/**
 * Item (5), retries: writers of one scope (4 and 16) on distinct rows and all on one hot row, at
 * READ COMMITTED with positioned loads (the specification), with the target's position read after
 * its lock, and at REPEATABLE READ; serialization retries, exhausted units and how often the locked
 * target was tagged with a position older than the row it returned (sections 7.9.4, 7.9.6, 14.3.6).
 */
export async function measureSnapshotRetries(
  postgres: RunningPostgres,
): Promise<MeasurementResult> {
  const admin = await connect(postgres.admin, 'seed');
  const [spread, hot] = (await seedScopes(admin, 410, 2, 64)) as SeededScope[];
  await admin.end();
  if (spread === undefined || hot === undefined) throw new Error('seeding failed');
  const plan = (['distinct rows', 'one hot row'] as const).flatMap((target) =>
    [4, 16].flatMap((writers) => variants.map((variant) => ({ target, writers, variant }))),
  );
  const runs = plan.map((): ResultRow[] => []);
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const [index, step] of plan.entries()) {
      const scope = step.target === 'one hot row' ? hot : spread;
      const run = await runAppends({
        app: postgres.app,
        writers: Array.from({ length: step.writers }, (_, writer) => ({
          scope,
          targets:
            step.target === 'one hot row'
              ? scope.entities.slice(0, 1)
              : scope.entities.slice(writer * 3, writer * 3 + 3),
          loads: scope.entities.slice(60, 62),
        })),
        unit: {
          ...positionVariants[step.variant],
          tail: 'statements',
          notifyInTransaction: false,
          auditTargetPosition: true,
        },
        warmupMs: 300,
        durationMs: 1500,
        seed: 7 + repetition,
      });
      const committed = run.samples.filter((sample) => sample.ok);
      const stale = committed.filter((sample) => sample.stale).length;
      runs[index]?.push({
        target: step.target,
        writers: step.writers,
        variant: step.variant,
        ...summarizeAppends(run),
        'stale target position/100 commits': Number(
          ((stale * 100) / Math.max(1, committed.length)).toFixed(1),
        ),
      });
    }
  }
  return {
    id: '5b',
    title: 'Serialization retries and stale positions on hot rows',
    sections: '7.9.4 phases 5 and 7, 7.9.6, 14.3.6, 15.1.6 step 2, 26.2 item 6',
    rows: runs.map((repeated) => medianRow(repeated, 'commits/s')),
    notes: [
      'Each decision loads two other rows and the locked target; one event per unit. Retries: version conflicts, serialization failures (40001) and deadlocks, up to three per unit with jitter; failed units exhausted them.',
      'Stale target position: the locked target load was tagged with a position below the last committed event of its stream (read in a later statement of the same unit), so `asOf` at the recorded position would return an older row than the decision saw.',
      `Medians of ${repetitions} runs of 1.5 s, the plan walked once per repetition.`,
    ],
  };
}
