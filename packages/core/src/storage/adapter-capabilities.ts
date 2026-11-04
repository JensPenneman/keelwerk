import type { ConditionOp } from '../conditions/condition-op.ts';
import type { EncryptedQueryCapabilities } from './encrypted-query-capabilities.ts';
import type { FieldKind } from './field-kind.ts';

/** What an adapter does natively; every absence has a kernel path (section 14.3.3). */
export interface AdapterCapabilities {
  readonly dialect: string;
  readonly eventStore: boolean;
  readonly transactions: {
    readonly savepoints: boolean;
    readonly transactionalDdl: boolean;
    readonly isolation: readonly ('read-committed' | 'repeatable-read' | 'serializable')[];
  };
  readonly placements: readonly ('shared-tables' | 'schema-per-tenant' | 'database-per-tenant')[];
  readonly naming: readonly ('prefix' | 'schema')[];
  readonly maxIdentifierLength: number;
  readonly unsupportedConditions: readonly {
    readonly op: ConditionOp;
    readonly kinds?: readonly FieldKind[];
    readonly reason: string;
  }[];
  readonly partialIndexes: 'native' | 'generated-column' | false;
  readonly changeFeed: 'poll' | 'notify' | 'stream';
  readonly rowLevelSecurity: boolean;
  readonly rowLocks: false | { readonly skipLocked: boolean; readonly noWait: boolean };
  /** Native plaintext search; false: the keyed token index serves it (section 14.7.9.9). */
  readonly search: false | 'tsvector' | 'fulltext' | 'fts5' | 'naive';
  /** JMAP position and anchor (section 14.3.5). */
  readonly positionPaging: false | { readonly maxOffset: number };
  /** How workers take jobs (section 14.3.9). */
  readonly jobs: 'skip-locked' | 'single-writer';
  /** Topics and presence across processes. */
  readonly broadcast: boolean;
  /** The raw-SQL hatch: the one capability a module may require (section 14.3.8). */
  readonly sql: false | { readonly dialect: 'postgres' | 'mysql' | 'sqlite' };
  /** In-memory: single; SQLite file: host; servers: network. */
  readonly processes: 'single' | 'host' | 'network';
  /** Personal fields: equality, tagSets, order, maxScan (section 14.7.9). */
  readonly encryptedQueries: EncryptedQueryCapabilities;
}
