import type { Condition } from '../conditions/condition.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { Position } from '../storage/position.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { SealingContext } from './sealing-context.ts';

const batch = 500;

/** The rows a bounded scan reads, and the position of the first read. */
export interface ScanCandidates {
  readonly rows: readonly StorageRow[];
  readonly position: Position | undefined;
}

/**
 * Reads every row a rewritten condition selects, in id order, for the kernel to unseal and
 * filter (S-37, 14.7.9.10). More than the adapter's `maxScan` is `core.scan_limit`: the scan never
 * silently stops short.
 */
export async function scanCandidates(
  context: SealingContext,
  entity: EntityDescriptor,
  where: Condition | undefined,
  options: {
    readonly includeArchived?: boolean;
    readonly forUpdate?: boolean;
    readonly positioned?: boolean;
  },
): Promise<ScanCandidates> {
  const rows: StorageRow[] = [];
  let position: Position | undefined;
  let after: string | undefined;
  for (;;) {
    const page = await context.unit.rows.find(entity, {
      ...(where === undefined ? {} : { where }),
      sort: [{ field: 'id', direction: 'asc' }],
      page: {
        first: Math.min(batch, context.maxScan + 1 - rows.length),
        ...(after === undefined ? {} : { after }),
      },
      ...(options.includeArchived === true ? { includeArchived: true } : {}),
      ...(options.forUpdate === true ? { forUpdate: true } : {}),
      ...(options.positioned === true && position === undefined
        ? { positioned: true as const }
        : {}),
    });
    position ??= page.position;
    rows.push(...page.rows);
    if (rows.length > context.maxScan) {
      throw new KeelwerkError({
        kind: 'unsupported',
        code: 'core.scan_limit',
        message: `The scan of "${entity.ref}" reached its limit of ${context.maxScan} rows.`,
      });
    }
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return { rows, position };
    after = page.pageInfo.endCursor;
  }
}
