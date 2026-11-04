import type { NamespaceRef, StorageScope } from '@keelwerk/core';
import type { PgliteAdapter, PgliteUnit } from '../../src/pglite/index.ts';
import type { TestClock } from './test-clock.ts';

/** A provisioned PGlite adapter and the helpers the store tests run units with. */
export interface StoreFixture {
  readonly adapter: PgliteAdapter;
  readonly clock: TestClock;
  /** The namespace a unit of this scope runs in. */
  namespaceOf(scope: StorageScope): NamespaceRef;
  /** A read-write unit. */
  run<T>(scope: StorageScope, fn: (unit: PgliteUnit) => Promise<T>): Promise<T>;
  /** A read-only unit. */
  read<T>(scope: StorageScope, fn: (unit: PgliteUnit) => Promise<T>): Promise<T>;
}
