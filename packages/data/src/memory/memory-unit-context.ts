import type {
  Clock,
  EntityDescriptor,
  NamespaceRef,
  Position,
  StorageRow,
  StorageScope,
} from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import type { MemoryNamespace } from './memory-namespace.ts';
import { memoryRowsName } from './memory-rows-name.ts';
import type { MemoryTransaction } from './memory-transaction.ts';

const scopeLevelOf = {
  tenant: 'tenant',
  backend: 'backend',
  deployment: 'deployment',
} as const;

/** The scope's id as collection names use it; `undefined` for the namespace level. */
function scopeKey(scope: StorageScope, deploymentId: string): string | undefined {
  switch (scope.level) {
    case 'tenant':
      return scope.tenantId;
    case 'backend':
      return scope.backendId;
    case 'deployment':
      return deploymentId;
    case 'namespace':
      return undefined;
  }
}

/** What every store of one unit shares: the scope, the copy-on-write view and the clock. */
export interface MemoryUnitContext {
  readonly namespace: NamespaceRef;
  readonly scope: StorageScope;
  readonly readOnly: boolean;
  readonly tx: MemoryTransaction;
  readonly clock: Clock;
  readonly state: MemoryNamespace;
  /** The deployment's id: the scope id of a deployment-scope unit, as in the SQL adapters. */
  readonly deploymentId: string;
  /** Positions this unit assigned at its commit tail. */
  readonly assigned: Position[];
  /** The id the unit's scope has in collection names; refuses a namespace-scope unit. */
  scopeId(): string;
  /** Refuses writes of a read-only unit. */
  writable(): void;
  /** The descriptor of an entity ref, from the calls so far or the adapter's lookup. */
  entity(ref: string): EntityDescriptor | undefined;
  /** Remembers a descriptor and refuses the entities this unit's scope cannot reach. */
  reach(entity: EntityDescriptor): string;
  /** The entity's rows in the unit's scope. */
  rows(entity: EntityDescriptor): ReadonlyMap<string, StorageRow>;
  /** The unit's own copy of the entity's rows, for a write. */
  writeRows(entity: EntityDescriptor): Map<string, StorageRow>;
}

/**
 * Builds the shared view of one unit. The scope predicate is structural: rows live in a
 * collection per entity table and scope id, so a unit cannot name another scope's rows, and an
 * entity of another tenancy is refused (a unit sees only its scope, section 14.3.6). An
 * `invocation` entity (15.1.7) belongs to whichever scope the command ran in, so a tenant,
 * backend or deployment unit stores its rows under the unit's own scope id.
 */
export function memoryUnitContext(
  parts: Pick<
    MemoryUnitContext,
    'namespace' | 'scope' | 'readOnly' | 'tx' | 'clock' | 'state' | 'deploymentId'
  >,
  lookup: ((ref: string) => EntityDescriptor | undefined) | undefined,
): MemoryUnitContext {
  const { scope, state } = parts;
  const scopeId = (): string => {
    const id = scopeKey(scope, parts.deploymentId);
    if (id === undefined) {
      throw new KeelwerkError({
        kind: 'forbidden',
        code: 'core.forbidden',
        message: 'a namespace-scope unit reaches no scoped data',
        details: { scope: scope.level },
      });
    }
    return id;
  };
  const reach = (entity: EntityDescriptor): string => {
    const id = scopeId();
    if (entity.tenancy !== 'invocation' && scopeLevelOf[entity.tenancy] !== scope.level) {
      throw new KeelwerkError({
        kind: 'forbidden',
        code: 'core.forbidden',
        message: `a ${scope.level}-scope unit cannot reach the ${entity.tenancy} entity ${entity.ref}`,
        details: { entity: entity.ref, scope: scope.level },
      });
    }
    state.entities.set(entity.ref, entity);
    return id;
  };
  return {
    ...parts,
    assigned: [],
    scopeId,
    writable: () => {
      parts.tx.check();
      if (parts.readOnly) throw errors.internal('a read-only unit cannot write');
    },
    entity: (ref) => state.entities.get(ref) ?? lookup?.(ref),
    reach,
    rows: (entity) => parts.tx.read<StorageRow>(memoryRowsName(entity.table, reach(entity))),
    writeRows: (entity) => {
      if (parts.readOnly) throw errors.internal('a read-only unit cannot write');
      return parts.tx.write<StorageRow>(memoryRowsName(entity.table, reach(entity)));
    },
  };
}
