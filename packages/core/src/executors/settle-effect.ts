import type { ControlStore } from '../control/control-store.ts';
import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import { settledEffectDraft } from '../effects/settled-effect-draft.ts';
import { writeEffectRecord } from '../effects/write-effect-record.ts';
import { errors } from '../errors/errors.ts';
import type { Clock } from '../kernel/clock.ts';
import type { QuotaView } from '../quotas/quota-view.ts';
import { reactionLineageOf } from '../reactions/reaction-lineage-of.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import type { Unit } from '../storage/unit.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { effectJobError } from './effect-job-error.ts';
import { effectSecretKeys } from './effect-secret-keys.ts';
import { enqueueContinuation } from './enqueue-continuation.ts';

/**
 * Writes `settled` on an effect once (7.9.6, lead 3): answers false and writes nothing when the
 * row's status is not `requested` (a second settle is recognised by the status, never by comparing
 * outputs), otherwise writes the settled change in the unit as the kernel (system actor through
 * `core.runtime`, the effect's command as command and correlation id, the effect ref as action, the
 * effect id as causation) and enqueues the continuation with `{ ok: true, value }` or, for a
 * failure, `{ ok: false, error: { code, message } }` of `effectJobError`, when the registry holds
 * the effect's type and the continuation names a command of this build (`enqueueContinuation`);
 * any error of the unit is rethrown, so a known continuation is never dropped. It destroys the
 * value keys of the input's secret members in the same unit (`effectSecretKeys`), whatever the
 * status and whatever the build has of the executor, the type or its shape (the keys are found
 * from the stored input), unless the effect's executor is inline; output keys stay for the
 * continuation. `continuation: 'skip'` settles without one. It never completes the job: the
 * caller does, in the same unit, through `completeJob`.
 */
export async function settleEffect(
  unit: Unit,
  target: {
    readonly registry: Registry;
    readonly row: StorageRow;
    /** `skip`: no continuation job, for an effect that has none to run (an inline effect). */
    readonly continuation?: 'skip';
    readonly cause: Pick<StoredJobSpec, 'scope' | 'causation' | 'build'>;
    readonly writer: ControlStore['writer'];
    readonly clock: Clock;
    /** The quota view asked for before the unit (`QuotaLimits.fresh`): the continuation's lane takes its cap and weight from it. */
    readonly limits: QuotaView | undefined;
  },
  settled:
    | { readonly status: 'succeeded'; readonly output: Readonly<Record<string, unknown>> }
    | { readonly status: 'failed' | 'abandoned'; readonly error: EffectAttemptError },
  attempts: number,
): Promise<boolean> {
  const { registry, writer } = target;
  if (target.row.status !== 'requested') return false;
  const id = String(target.row.id);
  // The status is decided under the row's lock: a second settle that read `requested` before the
  // first committed waits here, then finds the settled row and writes nothing.
  const descriptor = registry.entities.get('core.effect')?.descriptor;
  if (descriptor === undefined) throw errors.internal('the app has no core.effect entity');
  const row = await unit.rows.findOne(descriptor, {
    where: { op: 'eq', field: 'id', value: id },
    forUpdate: true,
  });
  if (row === undefined || row.status !== 'requested') return false;
  const commandId = String(row.commandId);
  // The registry's entry for the effect's type decides, never the executor: a build can have lost the executor and kept the type.
  const entry = registry.effects.get(String(row.type));
  const lineage = reactionLineageOf(target.cause.causation.lineage);
  const now = target.clock.now();
  const outcome =
    settled.status === 'succeeded'
      ? ({ ok: true, value: settled.output } as const)
      : ({
          ok: false,
          error: settled.error,
          ...(settled.status === 'abandoned' ? { abandoned: true as const } : {}),
        } as const);
  const settledEventId = await writeEffectRecord(
    {
      unit,
      run: { registry, behaviours: registryBehaviours(registry) },
      clock: target.clock,
      hybridClock: writer.hybridClock,
      meta: {
        actor: { kind: 'system', id: null, via: 'core.runtime' },
        commandId,
        action: entry?.ref ?? String(row.type),
        causationId: id,
        correlationId: commandId,
        client: null,
        merge: null,
        traceparent: null,
        writer: { build: writer.build.id, revision: writer.build.revision },
        flags: [],
        decision: null,
        ...(lineage === undefined ? {} : { lineage }),
      },
    },
    settledEffectDraft(id, now, outcome, attempts),
  );
  if (target.continuation !== 'skip' && entry !== undefined) {
    await enqueueContinuation(unit, {
      registry,
      row,
      settledEventId,
      outcome:
        settled.status === 'succeeded'
          ? { ok: true, value: settled.output }
          : { ok: false, error: effectJobError(settled.error) },
      cause: target.cause,
      now,
      limits: target.limits,
    });
  }
  // The input secrets die with the settle, except for an inline effect: its command may be repeated and then opens them to compare.
  // The keys are found from the stored input, never from the build's shape of it.
  const executor =
    entry === undefined || entry.executor === null
      ? undefined
      : registry.executors.get(entry.executor);
  if (executor?.inline !== true) {
    for (const keyId of await effectSecretKeys(unit, row, 'input')) {
      await unit.keys.destroyValueKey(keyId);
    }
  }
  return true;
}
