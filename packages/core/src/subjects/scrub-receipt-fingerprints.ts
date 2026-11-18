import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { erasedFingerprint } from './erased-fingerprint.ts';
import { erasureAction } from './erasure-action.ts';

const pageSize = 500;

/** The entity whose rows are the command receipts. */
const receiptRef = 'core.commandReceipt';

/**
 * Step 5a addition (WP-130, D5), in a writing tenant unit: sets the fingerprint of the receipt of
 * each command in `commandIds` to `erasedFingerprint`, so a receipt that another principal's
 * command left, which the erasure does not purge, holds no digest of an input that may have
 * carried the subject's values. A retry of such a command meets `core.idempotency_mismatch` and
 * never runs twice; the stored outcome stays. The receipt of `core.eraseSubject` keeps its
 * fingerprint, and a receipt that is scrubbed already is not written again, so a second call
 * answers 0. Pages of 500 command ids; archived rows included; each row is rewritten with the
 * version it was read at. Answers how many rows changed; 0 when the app has no receipt entity.
 */
export async function scrubReceiptFingerprints(
  unit: Unit,
  registry: Registry,
  commandIds: readonly string[],
): Promise<number> {
  const entry = registry.entities.get(receiptRef);
  if (entry === undefined) return 0;
  let changed = 0;
  for (let at = 0; at < commandIds.length; at += pageSize) {
    const chunk = commandIds.slice(at, at + pageSize);
    let after: string | undefined;
    for (;;) {
      const page = await unit.rows.find(entry.descriptor, {
        where: { op: 'in', field: 'commandId', value: chunk },
        page: { first: pageSize, ...(after === undefined ? {} : { after }) },
        includeArchived: true,
      });
      const updates = page.rows
        .filter((row) => row.action !== erasureAction && row.fingerprint !== erasedFingerprint)
        .map((row) => ({
          id: String(row.id),
          expectedVersion: Number(row.version),
          values: { ...row, fingerprint: erasedFingerprint, version: Number(row.version) + 1 },
        }));
      if (updates.length > 0) {
        await unit.rows.update(entry.descriptor, updates);
        changed += updates.length;
      }
      if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) break;
      after = page.pageInfo.endCursor;
    }
  }
  return changed;
}
