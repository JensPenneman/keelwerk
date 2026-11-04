import type { StorageScope } from '@keelwerk/core';
import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { inUnit } from './in-unit.ts';
import { ns } from './ns.ts';
import { runStatement } from './run-statement.ts';

/** The serial names a unit under `scope` can see, in order. */
export const serialNames = async (adapter: PgliteAdapter, scope: StorageScope): Promise<string[]> =>
  inUnit(adapter, scope, async (u) =>
    (await runStatement(u, `select field as name from ${ns}.kw_serials order by field`)).rows.map(
      (r) => String(r.name),
    ),
  );
