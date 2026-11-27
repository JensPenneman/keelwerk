import type { ControlStore } from '../control/control-store.ts';
import { deadlineTimerKey } from '../effects/deadline-timer-key.ts';
import { timerQueue } from '../effects/timer-queue.ts';
import { abandonOnLostLease } from '../executors/abandon-on-lost-lease.ts';
import { attemptErrorOf } from '../executors/attempt-error-of.ts';
import { attemptRecordBound } from '../executors/attempt-record-bound.ts';
import { latestAttemptRecords } from '../executors/latest-attempt-records.ts';
import { settleKeepingContinuation } from '../executors/settle-keeping-continuation.ts';
import type { AnyField } from '../fields/field-def.ts';
import { coreError } from '../http/core-error.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { QuotaView } from '../quotas/quota-view.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import { sealedMemberKeys } from './sealed-member-keys.ts';

function fieldsOf(schema: unknown): Readonly<Record<string, AnyField>> | undefined {
  return (schema as { readonly fields?: Readonly<Record<string, AnyField>> }).fields;
}

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
 * effect with no attempt open). The continuation runs with that outcome and the deadline timer
 * is cancelled. The value keys of the secret members of the input and output of any effect that
 * names the subject are destroyed (`onValueKeys` first). The row is read once, under its lock: the
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
  const entry = registry.effects.get(String(row.type));
  let changed = false;
  if (row.status === 'requested') {
    const { records, started } = await latestAttemptRecords(unit, effectId, attemptRecordBound);
    const unknown = abandonOnLostLease(records, Number.POSITIVE_INFINITY).open !== undefined;
    const error = attemptErrorOf(
      coreError(unknown ? 'core.effect_outcome_unknown' : 'core.key_destroyed'),
      newUuidV7(),
      new Set(),
    );
    const settled = await settleKeepingContinuation(
      unit,
      {
        registry,
        entry,
        row,
        cause: {
          scope: input.scope,
          causation: { commandId: record.commandId },
          build: input.writer.build,
        },
        writer: input.writer,
        clock: input.clock,
        limits: input.limits,
        ...(entry === undefined ? { continuation: 'skip' as const } : {}),
      },
      () => Promise.resolve({ status: unknown ? 'abandoned' : 'failed', error }),
      started.size,
    );
    if (settled !== undefined) {
      changed = true;
      if (row.deadline !== undefined && row.deadline !== null) {
        await unit.jobs.cancel(timerQueue, deadlineTimerKey(effectId));
      }
    }
  }
  const binding = { entity: 'core.effect', id: effectId };
  const keyIds =
    entry === undefined
      ? []
      : [
          ...(await sealedMemberKeys(unit, fieldsOf(entry.input), row.input, {
            ...binding,
            prefix: '',
          })),
          ...(await sealedMemberKeys(unit, fieldsOf(entry.output), row.output, {
            ...binding,
            prefix: 'output.',
          })),
        ];
  if (keyIds.length > 0) {
    await input.onValueKeys(keyIds);
    for (const keyId of keyIds) await unit.keys.destroyValueKey(keyId);
    changed = true;
  }
  return changed;
}
