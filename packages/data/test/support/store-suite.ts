import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { PgliteAdapter } from '../../src/pglite/index.ts';
import { pgliteAdapter, provisionApplicationRole } from '../../src/pglite/index.ts';
import { aesKeyWrapper } from '../../src/sql/aes-key-wrapper.ts';
import { frameworkTablesDdl } from '../../src/sql/postgres/framework-tables.ts';
import { rlsPoliciesDdl } from '../../src/sql/postgres/rls-policies.ts';
import { account } from './account.ts';
import { deployment } from './deployment.ts';
import { entities } from './entities.ts';
import { item } from './item.ts';
import { itemLabel } from './item-label.ts';
import { label } from './label.ts';
import { message } from './message.ts';
import { setting } from './setting.ts';
import { stamp } from './stamp.ts';
import { storeControlNamespace } from './store-control-namespace.ts';
import { storeDdl } from './store-ddl.ts';
import type { StoreFixture } from './store-fixture.ts';
import { storeNamespace } from './store-namespace.ts';
import { testClock } from './test-clock.ts';

const known = new Map(
  [...entities.values(), account, item, itemLabel, label, message, setting].map((entity) => [
    entity.ref,
    entity,
  ]),
);

const wrappingKey = new Uint8Array(32).fill(7);

/**
 * Call at the top of a test file: provisions one PGlite adapter with both roots, the fixture
 * tables and the application role before the file's tests, empties every table before each test
 * and closes the adapter afterwards. The returned fixture is valid inside the tests.
 */
export function storeSuite(): StoreFixture {
  const clock = testClock(stamp);
  let current: PgliteAdapter | undefined;
  const adapter = (): PgliteAdapter => {
    if (current === undefined) throw new Error('the store fixture is used outside a test');
    return current;
  };
  beforeAll(async () => {
    const opened = pgliteAdapter(
      { deploymentId: deployment },
      { clock, entities: (ref) => known.get(ref), keyWrapper: aesKeyWrapper(wrappingKey) },
    );
    await opened.connect();
    await opened.asOwner(async (database) => {
      for (const [root, options] of [
        [storeNamespace.root, {}],
        [storeControlNamespace.root, { control: true }],
      ] as const) {
        for (const statement of [
          ...frameworkTablesDdl(root, options),
          ...rlsPoliciesDdl(root, options),
        ]) {
          await database.query(statement);
        }
        await provisionApplicationRole(database, { root, role: 'kw_app', ...options });
        for (const statement of storeDdl(root, 'kw_app')) await database.query(statement);
      }
    });
    current = opened;
  }, 120_000);
  beforeEach(async () => {
    clock.advance(-clock.now().epochMilliseconds + stamp.epochMilliseconds);
    await adapter().asOwner(async (database) => {
      for (const root of [storeNamespace.root, storeControlNamespace.root]) {
        const tables = await database.query<{ tablename: string }>(
          'select tablename from pg_tables where schemaname = $1',
          [root],
        );
        const names = tables.rows
          .map((row) => row.tablename)
          .filter((name) => name !== 'kw_migrations')
          .map((name) => `${root}.${name}`);
        if (names.length > 0) await database.query(`truncate ${names.join(', ')}`);
      }
    });
  }, 60_000);
  afterAll(async () => {
    await current?.close(1000);
  }, 60_000);
  const namespaceOf = (scope: Parameters<StoreFixture['namespaceOf']>[0]) =>
    scope.level === 'deployment' ? storeControlNamespace : storeNamespace;
  return {
    get adapter() {
      return adapter();
    },
    clock,
    namespaceOf,
    run: (scope, fn) => adapter().unit(namespaceOf(scope), scope, fn),
    read: (scope, fn) => adapter().unit(namespaceOf(scope), scope, fn, { readOnly: true }),
  };
}
