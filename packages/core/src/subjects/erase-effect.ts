import type { ControlStore } from '../control/control-store.ts';
import { deadlineTimerKey } from '../effects/deadline-timer-key.ts';
import { timerQueue } from '../effects/timer-queue.ts';
import { abandonOnLostLease } from '../executors/abandon-on-lost-lease.ts';
import { attemptErrorOf } from '../executors/attempt-error-of.ts';
import { effectSecretKeys } from '../executors/effect-secret-keys.ts';
import { latestAttemptRecords } from '../executors/latest-attempt-records.ts';
import { settleEffect } from '../executors/settle-effect.ts';
import { coreError } from '../http/core-error.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { QuotaView } from '../quotas/quota-view.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';

/** What erasing one effect record reads. */
export interface EraseEffectInput {
  readonly registry: Registry;
  readonly effectId: string;
  readonly record: ErasureRecord;
  readonly scope: Scope;
  readonly writer: ControlStore['writer'];
  readonly clock: Clock;
  /** The quota view asked for before the unit (`QuotaLimits.fresh`), for the continuation's lane. */
  readonly limits: QuotaView | undefined;
  /**
   * Runs inside the unit with the value keys about to be destroyed, before they are: the caller
   * notes the keys whose tombstone it has not recorded and rolls the unit back before it commits.
   */
  readonly onValueKeys: (keyIds: readonly string[]) => Promise<void>;
}

/**
 * Step 4 of section 14.7.5 for an effect that names the subject, in the caller's writing tenant
 * unit. An effect that is still `requested` is settled: `abandoned` with `core.effect_outcome_unknown`
 * when an attempt of its executor started and has no end record (it may have reached its
 * destination), otherwise `failed` with `core.key_destroyed` (an external effect, and an executor
 * effect with no attempt open). The continuation runs with that outcome, unless it cannot be
 * enqueued: the erasure then settles the effect without it, so the effect never stays `requested`
 * with its secrets open. The deadline timer is cancelled. The value keys of the secret members of the input and output of any effect that
 * names the subject are destroyed, read before the settle and handed to `onValueKeys` first, so no key dies without its tombstone (the settle itself destroys the input keys). The row is read once, under its lock: the
 * end of a running attempt waits for this unit and then finds the effect settled, so it seals
 * nothing. Answers whether it changed anything: a second call changes nothing.
 */
export async function eraseEffect(unit: Unit, input: EraseEffectInput): Promise<boolean> {
  const { registry, effectId, record } = input;
  const descriptor = registry.entities.get('core.effect')?.descriptor;
  const row =
    descriptor === undefined
      ? undefined
      : await unit.rows.findOne(descriptor, {
          where: { op: 'eq', field: 'id', value: effectId },
          includeArchived: true,
          forUpdate: true,
        });
  if (row === undefined) return false;
  // The keys first: the caller records their tombstones before the settle below destroys the input keys.
  // The keys are found from the stored members, whatever the build holds of the type and its shape.
  const keyIds = [
    ...(await effectSecretKeys(unit, row, 'input')),
    ...(await effectSecretKeys(unit, row, 'output')),
  ];
  if (keyIds.length > 0) await input.onValueKeys(keyIds);
  let changed = false;
  if (row.status === 'requested') {
    const { records, attempts } = await latestAttemptRecords(unit, effectId);
    const unknown = abandonOnLostLease(records, Number.POSITIVE_INFINITY).open !== undefined;
    const error = attemptErrorOf(
      coreError(unknown ? 'core.effect_outcome_unknown' : 'core.key_destroyed'),
      newUuidV7(),
      new Set(),
    );
    const target = {
      registry,
      row,
      cause: {
        scope: input.scope,
        causation: { commandId: record.commandId },
        build: input.writer.build,
      },
      writer: input.writer,
      clock: input.clock,
      limits: input.limits,
    };
    const outcome = { status: unknown ? 'abandoned' : 'failed', error } as const;
    // The erasure settles the effect whatever happens to its continuation: one that cannot be
    // enqueued is left out, after the failed try has been rolled back.
    const settled = await unit
      .nested((nested) => settleEffect(nested, target, outcome, attempts))
      .catch(() => settleEffect(unit, { ...target, continuation: 'skip' }, outcome, attempts));
    if (settled) {
      changed = true;
      if (row.deadline !== undefined && row.deadline !== null) {
        await unit.jobs.cancel(timerQueue, deadlineTimerKey(effectId));
      }
    }
  }
  for (const keyId of keyIds) await unit.keys.destroyValueKey(keyId);
  return changed || keyIds.length > 0;
}
