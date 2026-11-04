import type { DeploymentDefinition } from '../runtime/deployment-definition.ts';
import type { ControlStore } from './control-store.ts';
import { findControlRows } from './find-control-rows.ts';
import { runControlCommand } from './run-control-command.ts';

const strategies = ['shared-tables', 'schema-per-tenant', 'database-per-tenant'] as const;
type Strategy = (typeof strategies)[number];

function strategyOf(value: unknown): Strategy {
  return strategies.find((strategy) => strategy === value) ?? 'shared-tables';
}

/**
 * Records the deployment's placements as `core.placement` rows (S-26): a missing row is created,
 * a row whose adapter or strategy differs from the deployment file is brought in line. Answers
 * the row id of each placement by name.
 */
export async function registerPlacements(
  store: ControlStore,
  placements: DeploymentDefinition['placements'],
): Promise<ReadonlyMap<string, string>> {
  const ids = new Map<string, string>();
  const created: { readonly name: string; readonly id: string }[] = [];
  const rows = await findControlRows(store, 'core.placement', {});
  const changes: {
    readonly row: (typeof rows)[number];
    readonly adapter: string;
    readonly strategy: Strategy;
  }[] = [];
  const missing: {
    readonly name: string;
    readonly adapter: string;
    readonly strategy: Strategy;
  }[] = [];
  for (const [name, placement] of Object.entries(placements)) {
    const strategy = strategyOf(placement.strategy);
    const row = rows.find((candidate) => candidate.name === name);
    if (row === undefined) {
      missing.push({ name, adapter: placement.adapter, strategy });
    } else {
      ids.set(name, String(row.id));
      if (row.adapter !== placement.adapter || row.strategy !== strategy) {
        changes.push({ row, adapter: placement.adapter, strategy });
      }
    }
  }
  if (missing.length === 0 && changes.length === 0) return ids;
  await runControlCommand(store, 'registerPlacements', (ctx) => {
    created.length = 0;
    const drafts = [];
    for (const item of missing) {
      const draft = ctx.write.core.placement.create({
        name: item.name,
        adapter: item.adapter,
        strategy: item.strategy,
      });
      created.push({ name: item.name, id: draft.id });
      drafts.push(draft);
    }
    for (const change of changes) {
      drafts.push(
        ctx.write.core.placement.update(String(change.row.id) as never, {
          adapter: change.adapter,
          strategy: change.strategy,
        }),
      );
    }
    return drafts;
  });
  for (const item of created) ids.set(item.name, item.id);
  return ids;
}
