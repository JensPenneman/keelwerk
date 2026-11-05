import { openStoredEvents } from '../encryption/open-stored-events.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { foldStoredEvent } from './fold-stored-event.ts';
import type { AsOfInput } from './read-as-of-position.ts';
import { replayOutsideHorizon } from './replay-outside-horizon.ts';
import { replayUnsupported } from './replay-unsupported.ts';

const pageSize = 500;

/** The streams that changed after the position, by id, each with its first later record. */
async function firstLaterRecords(input: AsOfInput): Promise<ReadonlyMap<string, StoredEvent>> {
  const { unit, entry } = input;
  const first = new Map<string, StoredEvent>();
  let after = input.at;
  for (;;) {
    const batch = await unit.events.readAll(after, {
      limit: pageSize,
      includeTransient: true,
      selector: { streamTypes: [entry.ref] },
    });
    for (const event of batch.events) {
      const known = first.get(event.stream.id);
      if (known === undefined || event.version < known.version) first.set(event.stream.id, event);
    }
    if (batch.next === null || batch.events.length === 0) return first;
    after = batch.next;
  }
}

/** The rows of the entity as they are now, archived ones included. */
async function currentRows(input: AsOfInput): Promise<StorageRow[]> {
  const { unit, entry } = input;
  const rows: StorageRow[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await unit.rows.find(entry.descriptor, {
      sort: [{ field: 'id', direction: 'asc' }],
      page: { first: pageSize, ...(after === undefined ? {} : { after }) },
      includeArchived: true,
    });
    rows.push(...page.rows);
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return rows;
    after = page.pageInfo.endCursor;
  }
}

/**
 * Every row of a `history: 'state'` entity as it was at a position of its scope (section 7.9.6).
 * A state entity keeps no chain, only transient change records within the feed horizon
 * (section 15.1.10): a stream with records after the position is folded back from its own
 * records before the first of them, a stream whose first later record creates it did not exist,
 * and every other row is the row of the table, unchanged since. A decision older than the horizon
 * is refused, and so is a stream whose earlier records are no longer unbroken from version 1.
 */
export async function readStateAsOfPosition(input: AsOfInput): Promise<readonly StorageRow[]> {
  const { unit, entry, horizon } = input;
  if (
    horizon !== undefined &&
    Temporal.Instant.compare(horizon.decidedAt, horizon.retainedSince) < 0
  ) {
    throw replayOutsideHorizon(entry.ref);
  }
  const later = await firstLaterRecords(input);
  const rows = await currentRows(input);
  if (later.size === 0) return rows;
  const folded = new Map<string, StorageRow | undefined>();
  for (const [id, record] of later) {
    if (record.type === `${entry.ref}.created`) {
      folded.set(id, undefined);
      continue;
    }
    const stream = await unit.events.readStream(record.stream, { toVersion: record.version - 1 });
    const records = await openStoredEvents(unit, stream);
    const unbroken =
      records.length === record.version - 1 &&
      records.every((event, index) => event.version === index + 1);
    if (!unbroken) {
      throw replayUnsupported(
        `the change records of ${entry.ref}/${id} before version ${record.version} are not kept from version 1 on (purged past the feed horizon).`,
      );
    }
    let state: StorageRow | undefined;
    for (const event of records) state = foldStoredEvent(entry, input.behaviours, state, event);
    folded.set(id, state);
  }
  const answered: StorageRow[] = [];
  const present = new Set<string>();
  for (const row of rows) {
    const id = String(row.id);
    present.add(id);
    if (!folded.has(id)) answered.push(row);
    else {
      const back = folded.get(id);
      if (back !== undefined) answered.push(back);
    }
  }
  // A row hard-deleted since the position is gone from the table but was there then.
  for (const [id, back] of folded) {
    if (back !== undefined && !present.has(id)) answered.push(back);
  }
  return answered;
}
