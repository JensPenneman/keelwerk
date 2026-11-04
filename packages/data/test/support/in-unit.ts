import type { StorageScope } from '@keelwerk/core';
import type { PgliteAdapter, PgliteUnitBase } from '../../src/pglite/index.ts';
import { namespaceRef } from './namespace-ref.ts';

/** Runs `fn` in a unit of the test namespace under `scope`. */
export const inUnit = async <T>(
  adapter: PgliteAdapter,
  scope: StorageScope,
  fn: (u: PgliteUnitBase) => Promise<T>,
): Promise<T> => adapter.unit(namespaceRef, scope, fn);
