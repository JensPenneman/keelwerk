import type { Condition } from '../conditions/condition.ts';
import type { EntityDescriptor } from './entity-descriptor.ts';
import type { KeyedUpdate } from './keyed-update.ts';
import type { RowPage } from './row-page.ts';
import type { RowQuery } from './row-query.ts';
import type { SearchRequest } from './search-request.ts';
import type { StorageRow } from './storage-row.ts';

/** Rows of a unit's scope (section 14.3.2). */
export interface RowStore {
  find(entity: EntityDescriptor, query: RowQuery): Promise<RowPage>;
  findOne(
    entity: EntityDescriptor,
    query: Omit<RowQuery, 'page' | 'total'>,
  ): Promise<StorageRow | undefined>;
  count(entity: EntityDescriptor, where?: Condition): Promise<number>;
  exists(entity: EntityDescriptor, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** Evaluates a condition for given rows inside the unit; used for relation quantifiers (section 14.3.4). */
  matching(
    entity: EntityDescriptor,
    ids: readonly string[],
    where: Condition,
  ): Promise<ReadonlySet<string>>;
  insert(entity: EntityDescriptor, rows: readonly StorageRow[]): Promise<void>;
  /** Each update must match exactly one row with `expectedVersion`; otherwise the call fails with `conflict`. */
  update(entity: EntityDescriptor, updates: readonly KeyedUpdate[]): Promise<void>;
  /** Hard delete: the retention worker, tenant retirement and `history: 'state'` entities only. */
  purge(entity: EntityDescriptor, ids: readonly string[]): Promise<number>;
  lock?(
    entity: EntityDescriptor,
    query: RowQuery,
    options: {
      readonly mode: 'update' | 'share';
      readonly skipLocked?: boolean;
      readonly noWait?: boolean;
    },
  ): Promise<readonly StorageRow[]>;
  search?(entity: EntityDescriptor, request: SearchRequest): Promise<RowPage>;
  /** Capability `positionPaging`: the number of rows before `id` in the query's order (JMAP `anchor`). */
  countBefore?(
    entity: EntityDescriptor,
    query: Omit<RowQuery, 'page'>,
    id: string,
  ): Promise<number>;
}
