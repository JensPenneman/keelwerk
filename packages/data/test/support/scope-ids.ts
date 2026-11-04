import type { StorageScope } from '@keelwerk/core';
import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { inUnit } from './in-unit.ts';
import { ns } from './ns.ts';
import { runStatement } from './run-statement.ts';

/** The scope ids of the rows of `table` that a unit under `scope` can see. */
export const scopeIds = async (
  adapter: PgliteAdapter,
  scope: StorageScope,
  table: string,
): Promise<string[]> =>
  inUnit(adapter, scope, async (u) =>
    (await runStatement(u, `select scope_id::text as "scopeId" from ${ns}.${table}`)).rows.map(
      (row) => String(row.scopeId),
    ),
  );
