import type { SchemaModule } from 'kysely';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';

/**
 * Kysely's schema builder for the namespace root `root`, over a driver that never connects: its
 * builders are only compiled to PostgreSQL text (section 14.6.2), and the kernel runs the text
 * inside the migration's transaction.
 */
export function schemaBuilder(root: string): SchemaModule {
  const database = new Kysely<object>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return database.schema.withSchema(root);
}
