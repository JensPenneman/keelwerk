import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Scope } from '../storage/scope.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { EntityBehaviours } from '../write-path/entity-behaviours.ts';
import { storedRowOf } from '../write-path/stored-row-of.ts';
import { alignInstants } from './align-instants.ts';
import { comparableRow } from './comparable-row.ts';
import { currentRows } from './current-rows.ts';
import { foldedStreams } from './folded-streams.ts';
import { rebuildOrder } from './rebuild-order.ts';
import type { RebuiltEntity } from './rebuilt-entity.ts';

const batchSize = 500;

/** Whether the table's row and the folded one hold other values, at the resolution of the instants the table keeps. */
function differs(have: StorageRow, wanted: StorageRow): boolean {
  const stored = comparableRow(have);
  return (
    canonicalizeJson(stored) !== canonicalizeJson(alignInstants(stored, comparableRow(wanted)))
  );
}

export interface RebuildFromChainInput {
  /** The kernel's sealing adapter (a placement handle's). */
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  /** A backend or tenant scope. */
  readonly scope: Scope;
  readonly registry: Registry;
  readonly behaviours: EntityBehaviours;
  readonly signal?: AbortSignal;
}

/**
 * Folds every `history: 'chain'` entity whose tenancy lives in the scope (tenant scope: tenant and
 * invocation; backend scope: backend and invocation) from its streams into its table, in the order
 * of `rebuildOrder`, one read-write unit per entity at isolation `repeatable-read`; then purges the
 * rows no stream accounts for, entity by entity in reverse order. A row the table lacks is
 * inserted, a row that differs is updated with its own version as the expected one, an equal row is
 * left: a rebuilt scope writes nothing. Appends no event, moves no position or head. Rejects with
 * `unsupported` for a broken chain, a stream not unbroken from version 1 or a reference cycle, and
 * with `conflict` when a writer changed a row meanwhile: run it again.
 */
export async function rebuildFromChain(
  input: RebuildFromChainInput,
): Promise<readonly RebuiltEntity[]> {
  const { adapter, namespace, scope, registry, behaviours } = input;
  const options = {
    isolation: 'repeatable-read',
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  } as const;
  const order = rebuildOrder(registry, scope);
  const rebuilt: { entity: RebuiltEntity; orphans: readonly string[] }[] = [];
  for (const entry of order) {
    rebuilt.push(
      await adapter.unit(
        namespace,
        scope,
        async (unit) => {
          const folded = await foldedStreams(unit, entry, behaviours);
          // Erased tombstones are rows of the table too: a stream that folds to one has its id there.
          const rows = new Map(
            (await currentRows(unit, entry, true)).map((row) => [String(row.id), row]),
          );
          const inserts: StorageRow[] = [];
          const updates: { id: string; expectedVersion: number; values: StorageRow }[] = [];
          for (const [id, row] of folded) {
            const wanted = storedRowOf(entry, row);
            const have = rows.get(id);
            if (have === undefined) inserts.push(wanted);
            else if (differs(have, wanted)) {
              updates.push({ id, expectedVersion: Number(have.version), values: wanted });
            }
          }
          for (let at = 0; at < inserts.length; at += batchSize) {
            await unit.rows.insert(entry.descriptor, inserts.slice(at, at + batchSize));
          }
          if (updates.length > 0) await unit.rows.update(entry.descriptor, updates);
          return {
            entity: {
              entity: entry.ref,
              streams: folded.size,
              inserted: inserts.length,
              updated: updates.length,
              purged: 0,
            },
            orphans: [...rows.keys()].filter((id) => !folded.has(id)),
          };
        },
        options,
      ),
    );
  }
  for (const item of [...rebuilt].reverse()) {
    const { orphans } = item;
    if (orphans.length === 0) continue;
    const entry = registry.entities.get(item.entity.entity);
    if (entry === undefined) continue;
    await adapter.unit(
      namespace,
      scope,
      async (unit) => {
        await unit.rows.purge(entry.descriptor, orphans);
      },
      options,
    );
  }
  return rebuilt.map(({ entity, orphans }) => ({ ...entity, purged: orphans.length }));
}
