import type { StorageScope } from '@keelwerk/core';
import type { Kysely } from 'kysely';
import { ScopingPlugin } from '../../src/sql/scoping-plugin.ts';
import type { SqlDb } from '../../src/sql/sql-db.ts';
import { dummyDb } from './dummy-db.ts';

/** A connectionless Kysely with the scoping plugin over a small fixed set of scoped tables. */
export function scopedDb(scope: StorageScope, deploymentId?: string): Kysely<SqlDb> {
  return dummyDb().withPlugin(
    new ScopingPlugin({
      scope,
      scoped: [
        { schema: 'app', name: 'notes', column: 'tenant_id' },
        { schema: 'app', name: 'members', column: 'tenant_id' },
        { schema: 'app', name: 'settings', column: 'backend_id' },
        { schema: 'app', name: 'kw_positions', column: 'scope_id' },
      ],
      unscoped: [{ schema: 'app', name: 'globals' }],
      ...(deploymentId === undefined ? {} : { deploymentId }),
    }),
  );
}
