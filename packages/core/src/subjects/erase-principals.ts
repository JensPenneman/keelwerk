import { commandQueue } from '../effects/command-queue.ts';
import { timerQueue } from '../effects/timer-queue.ts';
import { principalValueKeyId } from '../keys/principal-value-key-id.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { erasureAction } from './erasure-action.ts';
import { jobValueKeys } from './job-value-keys.ts';

const pageSize = 500;

/** The entity whose rows name the receipt's principal and the command that made it. */
const receiptRef = 'core.commandReceipt';

/** Stream ticket rows name their principal in `principalId` too. */
const ticketRef = 'live.streamTicket';

function* chunks(values: readonly string[]): Generator<readonly string[]> {
  for (let at = 0; at < values.length; at += pageSize) yield values.slice(at, at + pageSize);
}

/**
 * Walks the rows of `entry` that match `field in values`, page by page, and purges those `keep`
 * does not exempt. The walk follows the cursor, so rows that stay do not end it early.
 */
async function purgeMatching(
  unit: Unit,
  entry: EntityEntry,
  field: string,
  values: readonly string[],
  select: readonly string[],
  doomed: (row: StorageRow) => boolean,
): Promise<number> {
  let purged = 0;
  let after: string | undefined;
  for (;;) {
    const page = await unit.rows.find(entry.descriptor, {
      where: { op: 'in', field, value: values },
      select,
      page: { first: pageSize, ...(after === undefined ? {} : { after }) },
      includeArchived: true,
    });
    const ids = page.rows.filter(doomed).map((row) => String(row.id));
    if (ids.length > 0) purged += await unit.rows.purge(entry.descriptor, ids);
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return purged;
    // A purged row leaves the result, so the cursor is read from the page's own last row.
    after = page.pageInfo.endCursor;
  }
}

async function destroyValueKeys(
  unit: Unit,
  options: ErasePrincipalsOptions,
  keyIds: readonly string[],
): Promise<void> {
  if (keyIds.length === 0) return;
  await options.onValueKeys?.(keyIds);
  for (const keyId of keyIds) await unit.keys.destroyValueKey(keyId);
}

/** What `erasePrincipals` reports to its caller before it commits. */
export interface ErasePrincipalsOptions {
  /**
   * Runs inside the unit, with the ids of the value keys the purged jobs' secret members were
   * sealed under, BEFORE they are destroyed: the caller records their tombstones there, so a
   * failure rolls the unit back and a crash after the commit finds the tombstones recorded.
   */
  readonly onValueKeys?: (keyIds: readonly string[]) => Promise<void>;
  /**
   * The value keys the decision records of the commands the caller visited sealed their request
   * under (the user agent and transport a decision read), for the commands that have no principal
   * id: they are destroyed, tombstone first (`onValueKeys`). The request records of a command with
   * a principal id are sealed under the long-lived key of that id and go with `ids` below; those of
   * a user principal in a tenant are sealed under the subject's data key and are not listed.
   */
  readonly commandRequestKeys?: readonly string[];
}

/**
 * Step 5a of section 14.7.5, in one writing tenant unit: purges the command receipts (rows of
 * `core.commandReceipt`, which hold the principal's document, remote address and user agent), the
 * command jobs and timers the principals run as (`unit.jobs.purgeForPrincipals`; a job another
 * principal runs is kept, whoever caused it, and so are reaction and effect jobs), destroys the
 * value keys of the secret members of the jobs it purged, the long-lived value key of every id in
 * `ids` that has one (the key its request records are sealed under) and the keys in
 * `options.commandRequestKeys` (`options.onValueKeys` first) and, when
 * the app has `live.streamTicket`, purges its rows, each by the `principalId` that is among `ids`. `ids` are the
 * subject id and the ids of the rows the subject OWNS (never the ids of rows that only hold one
 * of its values), which are the principal ids a user or a session resolves to. `commandIds` are
 * the commands that wrote events in the owned rows: their receipts go too when they have no
 * principal of their own or one among `ids` (a sign-up or a login leaves its receipt with the
 * request's remote address and user agent), never when another principal ran them. A receipt of
 * `core.eraseSubject` is never purged, whichever way it is found: every erasure keeps its own,
 * which is completed last. Answers how many rows and jobs were purged; a second call finds none.
 */
export async function erasePrincipals(
  unit: Unit,
  registry: Registry,
  ids: readonly string[],
  commandIds: readonly string[] = [],
  options: ErasePrincipalsOptions = {},
): Promise<number> {
  let purged = 0;
  const receipts = registry.entities.get(receiptRef);
  const tickets = registry.entities.get(ticketRef);
  const principals = new Set(ids);
  if (receipts !== undefined) {
    for (const chunk of chunks(commandIds)) {
      purged += await purgeMatching(
        unit,
        receipts,
        'commandId',
        chunk,
        ['id', 'action', 'principalId'],
        (row) =>
          row.action !== erasureAction &&
          (typeof row.principalId !== 'string' || principals.has(row.principalId)),
      );
    }
  }
  await destroyValueKeys(unit, options, options.commandRequestKeys ?? []);
  for (const chunk of chunks(ids)) {
    if (receipts?.descriptor.fields.principalId !== undefined) {
      purged += await purgeMatching(
        unit,
        receipts,
        'principalId',
        chunk,
        ['id', 'action'],
        (row) => row.action !== erasureAction,
      );
    }
    if (tickets?.descriptor.fields.principalId !== undefined) {
      purged += await purgeMatching(unit, tickets, 'principalId', chunk, ['id'], () => true);
    }
    const jobs = await unit.jobs.purgeForPrincipals(chunk, [commandQueue, timerQueue]);
    purged += jobs.length;
    await destroyValueKeys(unit, options, await jobValueKeys(unit, registry, jobs));
    // One long-lived value key per principal id seals the request records of its commands.
    const live = await unit.keys.liveValueKeys(chunk.map(principalValueKeyId));
    await destroyValueKeys(unit, options, live);
  }
  return purged;
}
