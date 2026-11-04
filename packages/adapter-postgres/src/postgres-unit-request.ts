import type { Logger, NamespaceRef, StorageScope, UnitOptions } from '@keelwerk/core';
import type { SqlDb } from '@keelwerk/data';
import type { Kysely } from 'kysely';

/** What `runPostgresUnit` needs to open one unit. */
export interface PostgresUnitRequest {
  readonly db: Kysely<SqlDb>;
  readonly namespace: NamespaceRef;
  readonly scope: StorageScope;
  readonly options: UnitOptions | undefined;
  readonly deploymentId: string;
  readonly log: Logger;
}
