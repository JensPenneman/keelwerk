import { commandJobRun } from '../effects/command-job-run.ts';
import { commandQueue } from '../effects/command-queue.ts';
import { jobInput } from '../effects/job-input.ts';
import { sealJobInput } from '../effects/seal-job-input.ts';
import { errors } from '../errors/errors.ts';
import { kernelCommandId } from '../ids/kernel-command-id.ts';
import type { EffectOutcome } from '../model/effect-outcome.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * Hands the outcome of a settled effect to its continuation (7.9.5, D9): a command job in the
 * settling unit, so the settled record and the job commit together. No-op for an effect without
 * `continueWith`. The command id is the kernel form of the effect id and the job key is
 * `continuation:<effect id>` (kept on conflict), so the continuation is enqueued once however
 * often the effect is settled; the command runs under `<module>.system` of its own module (a
 * continuation is a command of the module whose decision requested the effect, which
 * `recordExternalEffect` checks) in the scope the effect was requested in. The job is caused by
 * the settled record, as a reaction's job is by its event. Its input is the effect's stored `with` and the `outcome`, sealed
 * as every command job's input is (`sealJobInput`). A continuation that names no command is
 * `internal`.
 */
export async function enqueueContinuation(
  unit: Unit,
  input: {
    readonly registry: Registry;
    readonly row: StorageRow;
    /** The settled record of the effect: the event that caused the continuation. */
    readonly settledEventId: string;
    readonly outcome: EffectOutcome<Readonly<Record<string, unknown>>>;
    readonly cause: Pick<StoredJobSpec, 'scope' | 'causation' | 'build'>;
    readonly now: Temporal.Instant;
  },
): Promise<void> {
  const { registry, row, cause } = input;
  const { continuation } = row;
  if (typeof continuation !== 'string') return;
  const effectId = String(row.id);
  const action = registry.actions.get(continuation);
  if (action === undefined || action.kind !== 'command') {
    throw errors.internal(
      `the continuation "${continuation}" of the effect ${effectId} is no command`,
    );
  }
  const { scope } = cause;
  const commandId = kernelCommandId('continuation', effectId);
  const stored: unknown = row.continuationWith;
  const extra = typeof stored === 'object' && stored !== null ? stored : {};
  await unit.jobs.enqueue({
    ...jobInput({
      ...(cause.causation.actor === undefined ? {} : { actor: cause.causation.actor }),
      scope,
      principal: moduleServicePrincipal(action.module, {
        scope: {
          backend: scope.level === 'deployment' ? null : scope.backendId,
          tenant: scope.level === 'tenant' ? scope.tenantId : null,
        },
      }),
      causation: {
        commandId: String(row.commandId),
        eventId: input.settledEventId,
      },
      caller: action.module,
      action,
      build: cause.build,
      now: input.now,
    }),
    kind: 'action',
    queue: commandQueue,
    run: commandJobRun(
      action.ref,
      await sealJobInput(unit, commandId, action, { ...extra, outcome: input.outcome }),
      commandId,
    ),
    key: { value: `continuation:${effectId}`, onConflict: 'keep' },
  });
}
