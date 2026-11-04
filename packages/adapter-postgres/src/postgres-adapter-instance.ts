import type { DataAdapter, NamespaceRef, StorageScope, UnitOptions } from '@keelwerk/core';
import type { PostgresUnitSession } from './postgres-unit-session.ts';

/** A `DataAdapter` that also hands out the unit session the stores are built over. */
export interface PostgresAdapterInstance extends DataAdapter {
  /** One transaction on one namespace for one scope, as a session rather than a finished `Unit`. */
  session<T>(
    namespace: NamespaceRef,
    scope: StorageScope,
    fn: (session: PostgresUnitSession) => Promise<T>,
    options?: UnitOptions,
  ): Promise<T>;
}
