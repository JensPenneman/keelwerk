import { beforeAll, expect, test } from 'vitest';
import {
  applyPending,
  columnType,
  compareCatalogue,
  pgSchemaConnection,
  postgresSchemaOperations,
  samePredicate,
} from '../../src/index.ts';
import { connect } from '../support/connect.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { TestDatabase } from '../support/test-database.ts';
import { conformanceSnapshots } from './support/conformance-snapshots.ts';
import { migrationNamespace } from './support/migration-namespace.ts';
import { planAllTracks } from './support/plan-all-tracks.ts';

let postgres: TestDatabase;

beforeAll(async () => {
  postgres = await createTestDatabase('migrations');
}, 120_000);

test('a planned migration applies on PostgreSQL and is introspected back equal to its snapshots', async () => {
  const schema = postgresSchemaOperations(
    pgSchemaConnection(async (url) => connect(url ?? postgres.adminUrl)),
    { role: 'kw_app' },
  );
  await schema.provision(migrationNamespace, []);
  const tracks = await planAllTracks(conformanceSnapshots);
  const applied = await applyPending(schema, migrationNamespace, tracks);
  expect(applied.applied).toHaveLength(tracks.length);
  const live = await schema.introspect({ namespace: migrationNamespace });
  const dialect = { typeOf: columnType, samePredicate };
  expect(compareCatalogue([...conformanceSnapshots.values()], live, dialect)).toEqual([]);
  expect((await schema.history(migrationNamespace)).map((row) => row.track).sort()).toEqual(
    tracks.map((entry) => entry.track).sort(),
  );
  const again = await applyPending(schema, migrationNamespace, tracks);
  expect(again.applied).toEqual([]);
  const byUrl = await schema.introspect({
    url: postgres.adminUrl,
    schema: migrationNamespace.root,
    tables: ['library__book'],
  });
  expect(byUrl.tables.map((table) => table.name)).toEqual(['library__book']);
}, 120_000);
