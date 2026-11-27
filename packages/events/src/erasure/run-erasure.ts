import type {
  EraseStreamResult,
  ErasureRecord,
  OwnedRowsCursor,
  OwnedRowsPage,
  RuntimeServiceContext,
  StreamRef,
  Unit,
  UnitGuard,
} from '@keelwerk/core';
import {
  canonicalSubject,
  completeErasureReceipt,
  createControlLedger,
  eraseEffect,
  erasePrincipals,
  eraseStream,
  errors,
  guardUnits,
  openRecordedKeys,
  ownedRows,
  ownedValueKeys,
  principalRateBuckets,
  reachErasure,
  recordScopeMarks,
  scrubFlagPrincipals,
  shredStep,
  subjectSpellings,
} from '@keelwerk/core';
import { destroyRecorded } from './destroy-recorded.ts';
import { ErasureHalted } from './erasure-halted.ts';
import type { ErasureOptions } from './erasure-options.ts';
import type { ErasureTarget } from './erasure-target.ts';
import { purgeBackendPrincipals } from './purge-backend-principals.ts';
import { type ReferencedRow, referencedRows } from './referenced-rows.ts';
import { settleAnswers } from './settle-answers.ts';
import { settleRows } from './settle-rows.ts';
import type { Settled } from './settled.ts';
import { streamKey } from './stream-key.ts';
import { tombstoneRecorder } from './tombstone-recorder.ts';
import { untilTombstoned } from './until-tombstoned.ts';

/** What one record is run with beyond the options of the worker. */
export type RunErasureOptions = Required<Pick<ErasureOptions, 'pageSize'>> &
  Pick<ErasureOptions, 'afterStep' | 'insideStep'> & {
    /**
     * The scope and key id pairs, and the scope, key id and command triples, whose tombstone this
     * process has seen the control ledger and every ledger sink take: a unit of that scope may
     * destroy those keys, and a repeat of the tombstone of that command needs no lookup. The caller
     * hands one set to every run, of every tenant; a tombstone this run records joins it.
     */
    readonly tombstoned: Set<string>;
    /**
     * The worker's hold on its units: runs `work` unless the worker stopped (then it throws), and
     * fails it when the work is abandoned at the stop deadline. It runs INSIDE every unit this
     * record opens, so the unit rolls back and the adapter refuses what the abandoned work still
     * sends: abandoned work writes nothing.
     */
    readonly guard?: UnitGuard;
  };

/**
 * Steps 1 to 6 of section 14.7.5 for one erasure record in its tenant: first appends the record to
 * every ledger sink again and fails until every sink has accepted it (a sink that refused the job's
 * append would otherwise leave an erasure that was done and never recorded where a restore cannot
 * lose it; readers keep one record of each erasure); shreds the subject's keys
 * (and appends the tombstones to the ledger and the sinks), erases first the rows that the keys
 * this erasure recorded a tombstone for that still open were made for (`openRecordedKeys`), walks
 * `kw_subject_refs` in pages of read units and erases each stream in one writing unit of its own
 * (`eraseStream`), then walks the rows the subject owns that hold no personal value
 * (`ownedRows`) the same way, purges the principals of
 * the rows that answered, then the subject's own, sweeps the keys made for no row, scrubs the flag
 * targeting and completes the
 * receipt, then appends the completion record to the control ledger (never to a sink). Every step
 * is idempotent and the record stays in the ledger, so a crash after any step is repaired by
 * running the record again. `afterStep` runs after each committed step.
 *
 * What follows from a row being the subject's is done after the unit that decided it, in units of
 * its own that hold no row's lock, and it is found by the answers that those units left (the
 * `erased` events of this erasure), not by a lookup of who owns what now: the
 * purge of the principal that the row's id stands for (receipts, jobs, tickets, rate buckets, the
 * keys of its request records), of the receipts of the commands that wrote in the row, and the
 * erased fingerprint of the receipts that stay, and the purge of the same principals in the
 * tenant's backend scope (the subject's own spellings excepted). A crash right after that unit,
 * and a holder that moves afterwards, lose none of it.
 */
export async function runErasure(
  context: RuntimeServiceContext,
  record: ErasureRecord,
  found: ErasureTarget,
  options: RunErasureOptions,
): Promise<void> {
  const { source, target } = found;
  const { registry } = source;
  const guard: UnitGuard = options.guard ?? ((work) => work());
  const guarded = guardUnits(target.handle.adapter, guard);
  const unit = <T>(readOnly: boolean, fn: (unit: Unit) => Promise<T>): Promise<T> =>
    guarded.unit(target.namespace, target.scope, fn, readOnly ? { readOnly } : {});
  const ledger = createControlLedger(
    guardUnits(context.control.adapter, guard),
    context.control.namespace,
  );
  /**
   * The keys with a tombstone for this erasure: the ones the control ledger holds after the
   * erasure's own record (a run that crashed after recording a tombstone and before destroying its
   * key left them, and a job may have turned running meanwhile), and the ones this run records.
   */
  const recorded = new Set<string>();
  /**
   * The keys of rows whose tombstone this erasure itself recorded (the record names its command),
   * this run's and an earlier run's: the only keys that name a row for the erasure to find. A
   * tombstone of another erasure names none of its rows.
   */
  const own = new Set<string>();
  // Tombstones are told apart by scope, key id and command, in the tenant and in its backend scope.
  const { recordTombstones, recordKeys, recordBackendKeys, knownInTenant, knownInBackend } =
    tombstoneRecorder({
      ledger,
      sinks: context.ledgers,
      guard,
      clock: context.clock,
      known: options.tombstoned,
      recorded,
      own,
      commandId: record.commandId,
      tenantId: record.tenantId,
      backendId: found.backend.scope.backendId,
    });
  const backendGuarded = guardUnits(found.backend.handle.adapter, guard);
  /**
   * The purge of the principals in one writing unit that calls no sink: it destroys keys through the
   * gate, and a key with no recorded tombstone rolls it back; the tombstones of those keys are
   * recorded outside any unit and the unit runs again.
   */
  const purgeTombstoned = async (
    work: (u: Unit, onValueKeys: (keyIds: readonly string[]) => Promise<void>) => Promise<unknown>,
  ): Promise<void> => {
    await untilTombstoned(knownInTenant, recordKeys, (gate) =>
      unit(false, async (u) => {
        await options.insideStep?.('principals', record);
        await work(u, gate.onValueKeys);
        gate.check();
      }),
    );
  };
  const after = async (step: Parameters<NonNullable<ErasureOptions['afterStep']>>[0]) => {
    await options.afterStep?.(step, record);
  };
  const { writer } = context.control;
  // The epoch the steps run under: a bump that lands meanwhile leaves the completion at the old one, so the erasure runs again.
  const epoch = context.control.epochOf(target.scope);

  // Step 1 is the ledger record itself. The job appended it to the control ledger and the sinks,
  // but a sink that refused it left the job's attempt to run again, which finds the control copy
  // and stops: the record goes to every sink again here, and the run fails until each has taken it.
  for (const sink of context.ledgers) {
    try {
      await guard(() => sink.append([record]));
    } catch (cause) {
      if (cause instanceof ErasureHalted) throw cause;
      throw errors.unavailable('A ledger sink refused the erasure record.', { cause });
    }
  }
  await after('ledger');

  // The tombstones an earlier run of this erasure recorded: the ledger lists them after the record.
  const { seq: started = 0n } =
    (
      await ledger.find(
        [
          {
            type: 'erasure',
            tenantId: record.tenantId,
            commandId: record.commandId,
            subjectId: canonicalSubject(record.subjectId),
          },
        ],
        { limit: 1 },
      )
    )[0] ?? {};
  for (let after = started; ; ) {
    const page = await ledger.find([{ type: 'keyTombstone', scopeId: record.tenantId }], { after });
    for (const { record: held } of page) {
      if (held.type === 'keyTombstone' && held.reason === 'erasure') {
        recorded.add(held.keyId);
        if (held.commandId === record.commandId) own.add(held.keyId);
      }
    }
    const last = page.at(-1);
    if (last === undefined) break;
    after = last.seq;
  }

  // The pending rows that name the subject's addresses are requested for erasure, once the keys that open the addresses are still there.
  await reachErasure({
    context,
    source,
    target: { ...target, handle: { ...target.handle, adapter: guarded } },
    record,
    insideUnit: async () => {
      await options.insideStep?.('reach', record);
    },
  });
  await after('reach');

  // Step 2, in the order of its crash points: the keys are destroyed and committed (`shred`), then
  // each tombstone the control ledger lacks is appended there and every tombstone goes to every
  // sink (`tombstones`). A rerun finds the destroyed keys again (`shreddedKeys`), so a crash
  // between any two statements is repaired.
  const tombstones = await unit(false, (u) =>
    shredStep(u, { keys: context.keys, subjectId: record.subjectId, at: context.clock.now() }),
  );
  await after('shred');
  await recordTombstones(tombstones);
  await after('tombstones');

  // The principal ids of the subject itself, in each of its spellings; the id of a row it owns is
  // purged after the unit that erases the row.
  const ids = new Set<string>(subjectSpellings(record.subjectId));
  // The streams that carry this erasure's `erased` event, however often a run reaches them (a run
  // that crashed, or a row that two walks both find): the count the receipt reports is the same
  // after a repair as after a run without one.
  const erased = new Set<string>();
  // The streams this run visited, with the answer of the unit that visited them: the effects and
  // the rows that left no event are settled from here, the others from their events.
  const visited = new Map<string, Settled>();

  /**
   * Erases one stream. `nominated`: the erasure found the row as the subject's (the lookup of the
   * owned rows, the reference walk with the row's data subject read as the subject's, or a key
   * record of this erasure), and not only because it holds a value of the subject. Whose row it is,
   * and so whether its keys are destroyed, is decided once, by the unit that holds the row's lock
   * (`eraseStream`). That unit leaves its answer in the `erased` event and does nothing else for
   * the row: the purge that follows from the answer runs afterwards, in units of its own.
   */
  const visit = async (stream: StreamRef, nominated: boolean): Promise<void> => {
    // The tombstones of the row's value keys first, so the unit below rarely rolls back; it names
    // the keys it destroys itself, through the gate (a secret may be set after the read, a performer
    // may settle an effect meanwhile), which rolls the unit back until each key has its tombstone.
    const effect = stream.type === 'core.effect';
    if (!effect) {
      await recordKeys(await unit(true, (u) => ownedValueKeys(u, { registry, stream, record })));
    }
    const limits = effect ? await context.quotas?.fresh() : undefined;
    let settled = false;
    const result = await untilTombstoned(knownInTenant, recordKeys, (gate) =>
      unit(false, async (u): Promise<EraseStreamResult> => {
        await options.insideStep?.('streams', record);
        let result: EraseStreamResult = { outcome: 'skipped', owned: false, valueKeys: [] };
        if (effect) {
          settled = await eraseEffect(u, {
            registry,
            effectId: stream.id,
            record,
            scope: target.scope,
            writer,
            clock: context.clock,
            limits,
            onValueKeys: gate.onValueKeys,
          });
        } else {
          result = await eraseStream(u, {
            registry,
            stream,
            record,
            writer,
            now: context.clock.now(),
            nominated,
            onValueKeys: gate.onValueKeys,
          });
        }
        gate.check();
        return result;
      }),
    );
    const key = streamKey(stream);
    if (result.outcome !== 'skipped') erased.add(key);
    visited.set(key, { stream, owned: result.owned || visited.get(key)?.owned === true });
    if (result.outcome === 'erased' || settled) await after('streams');
  };

  // The keys that this erasure itself recorded a tombstone for, that still open and were made for
  // a row of an app entity (the key record names its entity and row id): a row that this erasure
  // found and left before its unit ran goes through the same unit, as the subject's, even when its
  // owner was cleared since or the references reach it as a mere holder of a value. This source
  // runs FIRST so that no answer of the walks (a holder's: owned false) stands for such a row
  // before it is read. The tombstone of another erasure names no row.
  const keyed = [...own];
  for (let at = 0; at < keyed.length; at += options.pageSize) {
    const { rows } = await unit(true, (u) =>
      openRecordedKeys(u, registry, keyed.slice(at, at + options.pageSize)),
    );
    for (const stream of rows) await visit(stream, true);
  }

  // The references of the subject: a row found as the subject's only when its data subject is hers.
  let cursor: StreamRef | null = null;
  for (;;) {
    const from: StreamRef | null = cursor;
    const page: readonly ReferencedRow[] = await unit(true, (u) =>
      referencedRows(u, { registry, subjectId: record.subjectId, from, limit: options.pageSize }),
    );
    if (page.length === 0) break;
    for (const { stream, nominated } of page) await visit(stream, nominated);
    cursor = page.at(-1)?.stream ?? null;
  }

  // The rows the subject owns that hold no personal value have no reference: they are found by a
  // lookup per entity (erased rows included, so a run that crashed finds them again).
  let owned: OwnedRowsCursor | null = null;
  for (;;) {
    const from: OwnedRowsCursor | null = owned;
    const page: OwnedRowsPage = await unit(true, (u) =>
      ownedRows(u, {
        registry,
        subjectId: record.subjectId,
        includeErased: true,
        after: from,
        limit: options.pageSize,
      }),
    );
    for (const stream of page.rows) await visit(stream, true);
    if (page.next === null) break;
    owned = page.next;
  }

  await settleAnswers({
    read: (fn) => unit(true, fn),
    record,
    pageSize: options.pageSize,
    erased,
    visited,
    settle: async (rows) => {
      if (rows.length === 0) return;
      const owners = rows.filter(({ owned }) => owned).map(({ stream }) => stream.id);
      const rateBuckets = await principalRateBuckets(context.keys, target.scope, owners);
      await purgeTombstoned((u, onValueKeys) =>
        settleRows(u, { registry, record, rows, rateBuckets, onValueKeys }),
      );
      // The same rows' principals in the tenant's backend scope, in a unit of its own that holds
      // no row's lock; the subject's own spellings stay there: the same person may live in
      // another tenant of the backend.
      const subject = canonicalSubject(record.subjectId);
      const rowIds = owners.filter((id) => canonicalSubject(id) !== subject);
      if (rowIds.length === 0) return;
      await purgeBackendPrincipals({
        registry,
        rowIds,
        known: knownInBackend,
        record: recordBackendKeys,
        unit: (fn) => backendGuarded.unit(found.backend.namespace, found.backend.scope, fn, {}),
        inside: async () => options.insideStep?.('principals', record),
      });
    },
  });

  const rateBuckets = await principalRateBuckets(context.keys, target.scope, [...ids]);
  await purgeTombstoned(async (u, onValueKeys) => {
    await erasePrincipals(u, registry, [...ids], [], { onValueKeys, rateBuckets });
    await destroyRecorded(u, {
      registry,
      keyIds: [...recorded],
      pageSize: options.pageSize,
      onValueKeys,
    });
  });
  await after('principals');

  // The scrub's units run through the same guard, and the seam holds one in flight at the stop
  // deadline: the abandoned unit rolls back, and the next run does the whole scrub again.
  const scrubGuard: UnitGuard = (work) =>
    guard(async () => {
      await options.insideStep?.('flags', record);
      return work();
    });
  await scrubFlagPrincipals(context.control, record, { guard: scrubGuard });
  await after('flags');

  await unit(false, (u) =>
    completeErasureReceipt(u, record, erased.size, { writer, clock: context.clock, registry }),
  );
  await after('receipt');

  // The marks of the tenant's scope are raised right before the completion, so a completion never
  // stands without a mark that covers the erasure's own events: a backup taken before it (the window
  // between the shred and the completion included) restores counters below that mark, and the next
  // `connect` detects the restore (14.7.6).
  await guard(() =>
    recordScopeMarks(
      context.control,
      { namespace: source.namespace, handle: source.handle },
      { now: context.clock.now(), scopeIds: [record.tenantId] },
    ),
  );
  await ledger.append({
    type: 'erasureCompleted',
    tenantId: record.tenantId,
    commandId: record.commandId,
    subjectId: canonicalSubject(record.subjectId),
    epoch,
    recordedAt: context.clock.now().toString(),
  });
  await after('completed');
}
