import type { BenchWorld } from './bench-world.ts';
import { createDatabase } from './create-database.ts';
import type { PostgresUrls } from './postgres-urls.ts';
import { startBenchWorld } from './start-bench-world.ts';

/** A bench world on a database of its own, which the world's `stop` drops. */
export async function startPostgresWorld(container: PostgresUrls): Promise<BenchWorld> {
  const database = await createDatabase(container);
  try {
    const world = await startBenchWorld(database.urls);
    return {
      ...world,
      stop: async () => {
        try {
          await world.stop();
        } finally {
          await database.drop();
        }
      },
    };
  } catch (error) {
    await database.drop();
    throw error;
  }
}
