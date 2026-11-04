import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Position } from '../storage/position.ts';
import type { RowPage } from '../storage/row-page.ts';
import type { RowQuery } from '../storage/row-query.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';

/** The rows of a read and the scope position its snapshot saw (S-19). */
interface PositionedRows {
  readonly rows: readonly StorageRow[];
  readonly page: RowPage;
  readonly position: Position;
}

/** The reads of one entity in one unit, every one tagged with its position. */
export interface EntityRepository {
  /**
   * Finds rows. An unlocked read asks the adapter for the position in the same statement. A
   * locked read (`forUpdate`) takes the rows with the lock where the adapter has one, then reads
   * the position with `EventStore.head()` in a statement after the lock.
   */
  find(query: RowQuery): Promise<PositionedRows>;
}

/** A repository over a unit for one entity. */
export function createEntityRepository(unit: Unit, entry: EntityEntry): EntityRepository {
  const { descriptor } = entry;
  return {
    async find(query) {
      if (query.forUpdate === true) {
        const { positioned: _positioned, ...locking } = query;
        const rows =
          unit.rows.lock === undefined
            ? (await unit.rows.find(descriptor, locking)).rows
            : await unit.rows.lock(descriptor, locking, { mode: 'update' });
        const position = (await unit.events.head()) ?? 0n;
        const page: RowPage = {
          rows,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
          },
        };
        return { rows, page, position };
      }
      const page = await unit.rows.find(descriptor, { ...query, positioned: true });
      if (page.position === undefined) {
        throw new KeelwerkError({
          kind: 'internal',
          code: 'core.internal',
          message: `The adapter returned no position for a positioned read of "${entry.ref}".`,
        });
      }
      return { rows: page.rows, page, position: page.position };
    },
  };
}
