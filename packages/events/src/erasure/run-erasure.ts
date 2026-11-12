import type {
  ErasureRecord,
  KeyTombstoneRecord,
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
  erasePrincipals,
  eraseStream,
  errors,
  guardUnits,
  ownedRows,
  ownedValueKeys,
  scrubFlagPrincipals,
  shredStep,
  subjectSpellings,
} from '@keelwerk/core';
import { ErasureHalted } from './erasure-halted.ts';
import type { ErasureOptions } from './erasure-options.ts';
import { erasureTarget } from './erasure-target.ts';

/** Where the principal ids and the command ids of the owned rows an erasure visits are collected. */
interface Principals {
  readonly ids: Set<string>;
  readonly commandIds: Set<string>;
}

/** What one record is run with beyond the options of the worker. */
export type RunErasureOptions = Required<Pick<ErasureOptions, 'pageSize'>> &
  Pick<ErasureOptions, 'afterStep' | 'insideStep' | 'epochOf'> & {
    /**
     * The key ids the control ledger holds a tombstone for. The caller reads the ledger once and
     * hands the set to every run; a tombstone this run appends joins it.
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
 * (and appends the tombstones to the ledger and the sinks), walks `kw_subject_refs` in pages of
 * read units and erases each stream in one writing unit of its own (`eraseStream`), then walks the
 * rows the subject owns that hold no personal value (`ownedRows`) the same way, purges the
 * principals' receipts, jobs and tickets, scrubs the flag targeting and completes the receipt, then
 * appends the completion record to the control ledger (never to a sink). Every step is idempotent
 * and the record stays in the ledger, so a crash after any step is repaired by running the record
 * again. `afterStep` runs after each committed step.
 */
export async function runErasure(
  context: RuntimeServiceContext,
  record: ErasureRecord,
  options: RunErasureOptions,
): Promise<void> {
  const found = await erasureTarget(context, record);
  if (found === undefined) {
    context.log.warn('an erasure record names a tenant this process does not serve', {
      commandId: record.commandId,
    });
    return;
  }
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
  const known = options.tombstoned;
  /**
   * Tombstones go to the control ledger and to every sink, before any later step. A tombstone the
   * control ledger holds already (the step ran before and failed at a sink, or after it) is not
   * appended there again, but the sinks get it again: a sink that failed missed it, and a tombstone
   * twice in a sink changes nothing.
   */
  const recordTombstones = async (tombstones: readonly KeyTombstoneRecord[]): Promise<void> => {
    for (const tombstone of tombstones) {
      if (!known.has(tombstone.keyId)) {
        await ledger.append(tombstone);
        known.add(tombstone.keyId);
      }
      for (const sink of context.ledgers) await guard(() => sink.append([tombstone]));
    }
  };
  const keyTombstones = (keyIds: readonly string[]): readonly KeyTombstoneRecord[] =>
    keyIds.map(
      (keyId): KeyTombstoneRecord => ({
        type: 'keyTombstone',
        scopeId: record.tenantId,
        keyId,
        recordedAt: context.clock.now().toString(),
        reason: 'erasure',
      }),
    );
  /**
   * The purge of the principals' jobs destroys the value keys of their secret members in its own
   * unit: the tombstones are recorded first, inside that unit, so a failure rolls it back.
   */
  const purgeOptions = {
    onValueKeys: (keyIds: readonly string[]) => recordTombstones(keyTombstones(keyIds)),
  };
  const after = async (step: Parameters<NonNullable<ErasureOptions['afterStep']>>[0]) => {
    await options.afterStep?.(step, record);
  };
  const { writer } = context.control;
  const epoch = options.epochOf?.(target.scope) ?? context.control.epochOf(target.scope);

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

  // The principals a user or a session resolves to are the subject (in each of its spellings) and the rows it owns; the
  // commands that wrote in those rows left receipts. Rows that only hold one of the subject's
  // values belong to someone else, and so do their commands.
  const ids = new Set<string>(subjectSpellings(record.subjectId));
  const commandIds = new Set<string>();
  // The streams that carry this erasure's `erased` event, however often a run reaches them (a run
  // that crashed, or a row the reference walk and the owned walk both find): the count the receipt
  // reports is the same after a repair as after a run without one.
  const erased = new Set<string>();

  /**
   * Erases one stream. A row found by the lookup of the owned rows is owned by construction: its
   * id is a principal id whatever the erased event says (a replay on a state-history entity cannot
   * read the event it wrote before the crash).
   */
  const visit = async (
    stream: StreamRef,
    into: Principals,
    ownedByLookup: boolean,
  ): Promise<void> => {
    // The tombstones of the row's value keys first: once the unit below commits, the columns are
    // cleared and the ids cannot be read again, so a failed append could never be repaired.
    const valueKeys = await unit(true, (u) => ownedValueKeys(u, { registry, stream, record }));
    await recordTombstones(keyTombstones(valueKeys));
    const result = await unit(false, async (u) => {
      await options.insideStep?.('streams', record);
      return eraseStream(u, { registry, stream, record, writer, now: context.clock.now() });
    });
    if (result.owned || ownedByLookup) {
      into.ids.add(stream.id);
      const events = await unit(true, (u) => u.events.readStream(stream));
      for (const event of events) {
        // The erasure's own receipt is completed last, by step 6.
        if (event.commandId !== null && event.commandId !== record.commandId) {
          into.commandIds.add(event.commandId);
        }
      }
    }
    if (result.outcome !== 'skipped') erased.add(`${stream.type}\u0000${stream.id}`);
    if (result.outcome === 'erased') await after('streams');
  };

  let cursor: StreamRef | null = null;
  for (;;) {
    const from: StreamRef | null = cursor;
    const page: readonly StreamRef[] = await unit(true, (u) =>
      u.keys.refs(record.subjectId, from, options.pageSize),
    );
    if (page.length === 0) break;
    for (const stream of page) await visit(stream, { ids, commandIds }, false);
    cursor = page.at(-1) ?? null;
  }

  // The rows the subject owns that hold no personal value have no reference: they are found by a
  // lookup per entity (erased rows included, so a run that crashed finds them again), and the
  // principals of each page are purged with the page, which keeps the memory bounded.
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
    const pageful: Principals = { ids: new Set<string>(), commandIds: new Set<string>() };
    for (const stream of page.rows) await visit(stream, pageful, true);
    if (pageful.ids.size > 0) {
      await unit(false, (u) =>
        erasePrincipals(u, registry, [...pageful.ids], [...pageful.commandIds], purgeOptions),
      );
    }
    if (page.next === null) break;
    owned = page.next;
  }

  await unit(false, (u) => erasePrincipals(u, registry, [...ids], [...commandIds], purgeOptions));
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
