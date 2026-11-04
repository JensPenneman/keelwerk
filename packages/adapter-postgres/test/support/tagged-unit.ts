import type { Clock, StorageScope } from '@keelwerk/core';
import type { SqlUnit } from '@keelwerk/data';
import { sqlEntityIndex, sqlUnit } from '@keelwerk/data';
import { CompiledQuery } from 'kysely';
import type { PostgresAdapterInstance } from '../../src/postgres-adapter-instance.ts';
import { known } from './store-rows.ts';
import { testNamespace } from './test-namespace.ts';
import { testScopes } from './test-scopes.ts';

/**
 * Runs `fn` in a unit that names itself `kwtest:<label>` in `application_name` for its
 * transaction, so a sampler can tell which unit waits on which.
 */
export async function taggedUnit<T>(
  adapter: PostgresAdapterInstance,
  clock: Clock,
  scope: StorageScope,
  label: string,
  fn: (unit: SqlUnit) => Promise<T>,
): Promise<T> {
  return adapter.session(testNamespace, scope, async (session) => {
    await session.db.executeQuery(
      CompiledQuery.raw(`select set_config('application_name', $1, true)`, [`kwtest:${label}`]),
    );
    return fn(
      sqlUnit(session, {
        deploymentId: testScopes.deploymentId,
        clock,
        entities: sqlEntityIndex((ref) => known.get(ref)),
      }),
    );
  });
}
