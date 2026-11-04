import type { Client } from 'pg';
import { deterministicUuid } from './deterministic-uuid.ts';
import { namespaceRoot } from './namespace-root.ts';
import type { SeededScope } from './seeded-scope.ts';

/**
 * Creates `count` scopes starting at scope index `first`: one kw_positions row each (next 1, epoch 1)
 * and `entities` demo__item rows at version 0. Ids derive from the indexes, so runs are repeatable.
 */
export async function seedScopes(
  admin: Client,
  first: number,
  count: number,
  entities: number,
): Promise<readonly SeededScope[]> {
  const scopes: SeededScope[] = [];
  for (let index = first; index < first + count; index += 1) {
    const ids = Array.from({ length: entities }, (_, entity) =>
      deterministicUuid(2, index, entity),
    );
    scopes.push({ index, id: deterministicUuid(1, index, 0), entities: ids });
  }
  await admin.query(
    `insert into ${namespaceRoot}.kw_positions (scope_id, next, epoch) select unnest($1::uuid[]), 1, 1`,
    [scopes.map((scope) => scope.id)],
  );
  await admin.query(
    `insert into ${namespaceRoot}.demo__item (tenant_id, id, version, title, count, kw_last_hlc)
     select tenant, id, 0, 'item', 0, '0' from unnest($1::uuid[], $2::uuid[]) as seed (tenant, id)`,
    [
      scopes.flatMap((scope) => scope.entities.map(() => scope.id)),
      scopes.flatMap((scope) => scope.entities),
    ],
  );
  return scopes;
}
