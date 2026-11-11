import type { ControlStore } from '../control/control-store.ts';
import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import { settledEffectDraft } from '../effects/settled-effect-draft.ts';
import { writeEffectRecord } from '../effects/write-effect-record.ts';
import { errors } from '../errors/errors.ts';
import type { Clock } from '../kernel/clock.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import type { Unit } from '../storage/unit.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { effectJobError } from './effect-job-error.ts';
import { enqueueContinuation } from './enqueue-continuation.ts';

/**
 * Writes `settled` on an effect once (7.9.6, lead 3): answers false and writes nothing when the
 * row's status is not `requested` (a second settle is recognised by the status, never by comparing
 * outputs), otherwise writes the settled change in the unit as the kernel (system actor through
 * `core.runtime`, the effect's command as command and correlation id, the effect ref as action, the
 * effect id as causation) and enqueues the continuation with `{ ok: true, value }` or, for a
 * failure, `{ ok: false, error: { code, message } }` of `effectJobError`. It never completes the
 * job: the caller does, in the same unit, through `completeJob`.
 */
export async function settleEffect(
  unit: Unit,
  target: {
    readonly registry: Registry;
    /** Absent when the registry no longer holds the effect: the action is then the row's `type`. */
    readonly entry?: EffectEntry | undefined;
    readonly row: StorageRow;
    /** `skip`: no continuation job, for an effect whose continuation is unknown or not to be run. */
    readonly continuation?: 'skip';
    readonly cause: Pick<StoredJobSpec, 'scope' | 'causation' | 'build'>;
    readonly writer: ControlStore['writer'];
    readonly clock: Clock;
  },
  settled:
    | { readonly status: 'succeeded'; readonly output: Readonly<Record<string, unknown>> }
    | { readonly status: 'failed' | 'abandoned'; readonly error: EffectAttemptError },
  attempts: number,
): Promise<boolean> {
  const { registry, entry, writer } = target;
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
      },
    },
    settledEffectDraft(id, now, outcome, attempts),
  );
  if (target.continuation !== 'skip') {
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
    });
  }
  return true;
}
