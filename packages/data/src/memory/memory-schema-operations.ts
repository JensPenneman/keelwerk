import type { SchemaOperations } from '@keelwerk/core';
import { canonicalizeJson, errors, KeelwerkError } from '@keelwerk/core';
import { sha256 } from '@keelwerk/core/crypto';
import { memoryApplyStep } from './memory-apply-step.ts';
import type { MemoryDatabase } from './memory-database.ts';
import { memoryDescribeStep } from './memory-describe-step.ts';

/**
 * The schema contract of the in-memory adapter (14.6.7). DDL is transactional here: a file is
 * applied to a draft of the catalogue and the rows, and installed only when every step passed.
 * Applying takes the namespace's unit lock, so no unit sees half a migration; `lock` is the
 * separate migration lock the planner holds around `apply`.
 */
export function memorySchemaOperations(database: MemoryDatabase): SchemaOperations {
  return {
    render: (_namespace, steps) => steps.map(memoryDescribeStep),
    apply: async (namespace, file) => {
      const release = await database.lock(namespace.id);
      try {
        const state = database.namespace(namespace);
        const checksum = sha256(canonicalizeJson(file.steps));
        const applied = state.migrations.find(
          (migration) => migration.track === file.track && migration.id === file.id,
        );
        if (applied !== undefined) {
          if (applied.checksum === checksum) return;
          throw new KeelwerkError({
            kind: 'conflict',
            code: 'core.conflict',
            message: `migration ${file.id} of ${file.track} changed after it was applied`,
          });
        }
        const draft = {
          tables: new Map(state.tables),
          tableOf: new Map(state.tableOf),
          collections: new Map(state.collections),
        };
        for (const step of file.steps) memoryApplyStep(draft, step);
        state.tables.clear();
        for (const [name, table] of draft.tables) state.tables.set(name, table);
        state.tableOf.clear();
        for (const [entity, name] of draft.tableOf) state.tableOf.set(entity, name);
        state.collections.clear();
        for (const [name, collection] of draft.collections) state.collections.set(name, collection);
        state.migrations.push({
          track: file.track,
          id: file.id,
          checksum,
          appliedAt: database.clock.now(),
          stepsApplied: file.steps.length,
        });
      } finally {
        release();
      }
    },
    history: async (namespace) => [...database.namespace(namespace).migrations],
    provision: async (namespace, snapshots) => {
      const release = await database.lock(namespace.id);
      try {
        const state = database.namespace(namespace);
        for (const snapshot of snapshots) {
          for (const table of snapshot.tables) {
            if (!state.tables.has(table.name)) state.tables.set(table.name, table);
          }
        }
      } finally {
        release();
      }
    },
    introspect: async (target) => {
      if (!('namespace' in target)) {
        throw errors.unsupported('the in-memory adapter has nothing to introspect by url');
      }
      return { tables: [...database.namespace(target.namespace).tables.values()] };
    },
    lock: async (namespace, fn) => {
      const release = await database.lock(`${namespace.id}/migration`);
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
