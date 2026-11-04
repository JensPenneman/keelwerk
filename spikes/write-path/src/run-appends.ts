import type { ClientConfig } from 'pg';
import { appendCommand } from './append-command.ts';
import type { AppendRequest } from './append-request.ts';
import type { AppendTiming } from './append-timing.ts';
import { connect } from './connect.ts';
import { createRandom } from './create-random.ts';
import type { LoadRun } from './load-run.ts';
import { runLoad } from './run-load.ts';
import type { SeededScope } from './seeded-scope.ts';
import type { StepSample } from './step-sample.ts';
import { withRetries } from './with-retries.ts';
import type { WriterAssignment } from './writer-assignment.ts';

/**
 * Runs one dedicated connection per writer assignment (application name `w:<scope>:<writer>`), each
 * repeating the command unit with retries, and reports the measured window. `afterCommit` is the
 * unit's afterCommit hook (section 14.3.7).
 */
export async function runAppends(options: {
  readonly app: ClientConfig;
  readonly writers: readonly WriterAssignment[];
  readonly unit: Pick<
    AppendRequest,
    | 'isolation'
    | 'positionedLoads'
    | 'targetPosition'
    | 'tail'
    | 'notifyInTransaction'
    | 'auditTargetPosition'
  >;
  readonly warmupMs: number;
  readonly durationMs: number;
  readonly ratePerWorker?: number | undefined;
  readonly afterCommit?: ((scope: SeededScope, timing: AppendTiming) => void) | undefined;
  readonly seed: number;
}): Promise<LoadRun<StepSample>> {
  const clients = await Promise.all(
    options.writers.map((writer, index) =>
      connect(options.app, `w:${writer.scope.index}:${index}`),
    ),
  );
  try {
    return await runLoad<StepSample>({
      workers: clients.length,
      warmupMs: options.warmupMs,
      durationMs: options.durationMs,
      ratePerWorker: options.ratePerWorker,
      step: async (worker, iteration) => {
        const client = clients[worker];
        const writer = options.writers[worker];
        if (client === undefined || writer === undefined) throw new Error(`no writer ${worker}`);
        const random = createRandom(options.seed * 1_000_003 + worker * 7_919 + iteration);
        const target = writer.targets[iteration % writer.targets.length] ?? '';
        const outcome = await withRetries(
          () =>
            appendCommand(client, {
              ...options.unit,
              scope: writer.scope,
              target,
              loads: writer.loads,
              enqueueLane: writer.enqueueLane,
            }),
          random,
        );
        const timing = outcome.value;
        if (timing !== undefined) options.afterCommit?.(writer.scope, timing);
        return {
          ok: timing !== undefined,
          retries: outcome.retries,
          tailWaitMs: timing?.tailWaitMs ?? Number.NaN,
          tailHoldMs: timing?.tailHoldMs ?? Number.NaN,
          loadMs: timing?.loadMs ?? [],
          stale: timing?.staleTargetPosition ?? false,
        };
      },
    });
  } finally {
    await Promise.all(clients.map((client) => client.end()));
  }
}
