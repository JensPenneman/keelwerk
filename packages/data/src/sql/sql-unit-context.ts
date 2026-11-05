import type { Clock, EntityDescriptor, NamespaceRef, StorageScope } from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import type { Kysely } from 'kysely';
import { commandReceiptTable } from './postgres/command-receipt-table.ts';
import type { ScopeColumn } from './scope-column.ts';
import type { ScopedTable } from './scoping-plugin.ts';
import { ScopingPlugin } from './scoping-plugin.ts';
import type { SqlDb } from './sql-db.ts';
import type { SqlEntityIndex } from './sql-entity-index.ts';
import { sqlFrameworkScopeTables } from './sql-framework-scope-tables.ts';
import type { SqlKeyWrapper } from './sql-key-wrapper.ts';
import { throughHops } from './through-hops.ts';

function scopeColumnOf(entity: EntityDescriptor, scope: StorageScope): ScopeColumn | undefined {
  switch (entity.tenancy) {
    case 'tenant':
      return 'tenant_id';
    case 'backend':
      return 'backend_id';
    case 'deployment':
      // Deployment-wide rows have no scope column; only a deployment unit may reach them. The
      // column named here is one the other scopes have no value for, so the plugin refuses them.
      return scope.level === 'tenant'
        ? 'backend_id'
        : scope.level === 'backend'
          ? 'tenant_id'
          : undefined;
    case 'invocation':
      // A receipt-like row carries the scope of the command that wrote it (15.1.7): the
      // coalesce of the tenant, the backend or the deployment id.
      return 'scope_id';
  }
}

/** The entities and the relation targets, joins included, they reach. */
function reachable(
  entities: readonly EntityDescriptor[],
  index: SqlEntityIndex,
): readonly EntityDescriptor[] {
  const seen = new Map<string, EntityDescriptor>();
  const visit = (entity: EntityDescriptor): void => {
    if (seen.has(entity.ref)) return;
    seen.set(entity.ref, entity);
    for (const relation of Object.values(entity.relations)) {
      for (const hop of throughHops(relation)) {
        const next = index.find(hop.target);
        if (next !== undefined) visit(next);
      }
    }
  };
  for (const entity of entities) visit(entity);
  return [...seen.values()];
}

/** What every store of one SQL unit shares: the scope, the transaction's handle and the clock. */
export interface SqlUnitContext {
  readonly namespace: NamespaceRef;
  readonly scope: StorageScope;
  readonly readOnly: boolean;
  readonly deploymentId: string;
  readonly clock: Clock;
  readonly keyWrapper: SqlKeyWrapper | undefined;
  readonly entities: SqlEntityIndex;
  /** Kysely over the unit's transaction, without the scoping plugin. */
  readonly db: Kysely<SqlDb>;
  /** Refuses writes of a read-only unit. */
  writable(): void;
  /** The id the unit's scope has in `scope_id` columns; refuses a namespace-scope unit. */
  scopeId(): string;
  /** `<root>.<table>` for a table of the unit's namespace. */
  table(name: string): string;
  /**
   * Kysely over the unit's transaction with the scoping plugin for the framework tables, the given
   * entities and every entity they reach through a relation. A table outside that set, or of
   * another scope level, is refused (section 14.3.8).
   */
  scopedDb(entities?: readonly EntityDescriptor[]): Kysely<SqlDb>;
  /** The same for the control root's `kw_scope_keys`, which a deployment unit reads across scopes (S-55). */
  controlDb(): Kysely<SqlDb>;
}

/** The parts of a unit's context the adapter supplies. */
export type SqlUnitContextParts = Pick<
  SqlUnitContext,
  'namespace' | 'scope' | 'readOnly' | 'deploymentId' | 'clock' | 'keyWrapper' | 'entities' | 'db'
>;

export function sqlUnitContext(parts: SqlUnitContextParts): SqlUnitContext {
  const { scope, namespace } = parts;
  const root = namespace.root;
  const scopeId = (): string => {
    switch (scope.level) {
      case 'tenant':
        return scope.tenantId;
      case 'backend':
        return scope.backendId;
      case 'deployment':
        return parts.deploymentId;
      case 'namespace':
        throw new KeelwerkError({
          kind: 'forbidden',
          code: 'core.forbidden',
          message: 'a namespace-scope unit reaches no scoped data',
          details: { scope: scope.level },
        });
    }
  };
  const frameworkTables: readonly ScopedTable[] = [
    ...sqlFrameworkScopeTables,
    commandReceiptTable,
  ].map((name) => ({ schema: root, name, column: 'scope_id' as const }));
  return {
    ...parts,
    writable: () => {
      if (parts.readOnly) throw errors.internal('a read-only unit cannot write');
    },
    scopeId,
    table: (name) => `${root}.${name}`,
    scopedDb: (entities = []) => {
      scopeId();
      for (const entity of entities) parts.entities.learn(entity);
      const scoped: ScopedTable[] = [...frameworkTables];
      const unscoped: { readonly schema: string; readonly name: string }[] = [];
      for (const entity of reachable(entities, parts.entities)) {
        const column = scopeColumnOf(entity, scope);
        if (column === undefined) unscoped.push({ schema: root, name: entity.table });
        else scoped.push({ schema: root, name: entity.table, column });
      }
      return parts.db.withPlugin(
        new ScopingPlugin({
          scope,
          scoped,
          unscoped,
          deploymentId: parts.deploymentId,
        }),
      );
    },
    controlDb: () => {
      scopeId();
      return parts.db.withPlugin(
        new ScopingPlugin({
          scope,
          scoped: [],
          unscoped: [{ schema: root, name: 'kw_scope_keys' }],
          deploymentId: parts.deploymentId,
        }),
      );
    },
  };
}
