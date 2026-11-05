import type { Clock, DataAdapter, DataAdapterFactory } from '@keelwerk/core';
import { errors, newUuidV7 } from '@keelwerk/core';
import type { MemoryAdapterOptions } from './memory-adapter-options.ts';
import { memoryCapabilities } from './memory-capabilities.ts';
import { memoryChangeFeed } from './memory-change-feed.ts';
import { memoryDatabase } from './memory-database.ts';
import { memorySchemaOperations } from './memory-schema-operations.ts';
import { memoryUnit } from './memory-unit.ts';

/** The bound of a scan the store has no index for (S-37). */
const maxScan = 10_000;

const systemClock: Clock = { now: () => Temporal.Now.instant() };

/**
 * The in-memory adapter (14.3.7): the reference semantics every other adapter is compared with.
 * Every mandatory operation, the event store with positions per scope, receipts, jobs, keys, an
 * in-process feed, savepoints as snapshots and units serialised per namespace; naive substring
 * search, no SQL hatch, one process. Listed in a deployment as the adapter `memory`, with the
 * `shared-tables` strategy.
 */
export function memoryAdapter(options: MemoryAdapterOptions = {}): DataAdapterFactory {
  return {
    id: 'memory',
    dialect: 'memory',
    options: {
      '~standard': { version: 1, vendor: 'keelwerk', validate: (value) => ({ value }) },
    },
    create: (placement, env): DataAdapter => {
      if (placement.strategy !== 'shared-tables') {
        throw errors.unsupported(
          `the memory adapter hosts the shared-tables strategy, not ${placement.strategy}`,
        );
      }
      const database = memoryDatabase(
        options.clock ?? systemClock,
        { systemId: `memory-${newUuidV7()}`, timeline: '1' },
        env.deploymentId,
      );
      const environment = {
        database,
        log: env.log,
        lookup: options.entities,
      };
      return {
        placementId: placement.id,
        connect: async () => memoryCapabilities(maxScan),
        close: async () => {
          database.close();
        },
        health: async () => (database.isClosed() ? { ok: false, detail: 'closed' } : { ok: true }),
        unit: (namespace, scope, fn, unitOptions) =>
          memoryUnit(environment, namespace, scope, fn, unitOptions),
        schema: memorySchemaOperations(database),
        feed: memoryChangeFeed(database),
        identity: async () => database.cluster,
      };
    },
  };
}
