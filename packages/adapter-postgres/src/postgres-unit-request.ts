import type { Logger, NamespaceRef, StorageScope, Tracer, UnitOptions } from '@keelwerk/core';
import type { SqlDb, SqlUnitParts } from '@keelwerk/data';
import type { Kysely } from 'kysely';

/** What `runPostgresUnit` needs to open one unit. */
export interface PostgresUnitRequest {
  readonly db: Kysely<SqlDb>;
  readonly namespace: NamespaceRef;
  readonly scope: StorageScope;
  readonly options: UnitOptions | undefined;
  readonly deploymentId: string;
  readonly log: Logger;
  readonly tracer: Tracer;
  /** What the stores need besides the session: the clock, the descriptors seen, the key wrapper. */
  readonly parts: SqlUnitParts;
}
