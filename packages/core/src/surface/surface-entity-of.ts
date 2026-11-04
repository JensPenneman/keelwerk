import { compareCodePoints } from '../conditions/compare-code-points.ts';
import { compositionError } from '../registry/composition-error.ts';
import type { CompositionProblem } from '../registry/composition-problem.ts';
import type { EntityModel } from '../registry/entity-model.ts';
import type { RelationDescriptor } from '../storage/relation-descriptor.ts';
import type { FieldNode } from './field-node.ts';
import { fieldNodeOf } from './field-node-of.ts';
import type { SurfaceEntity } from './surface-entity.ts';
import type { SurfaceRelation } from './surface-relation.ts';

/** The `tenantId` of a row is the scope's, never a field of the surface (section 16.2.4). */
const scopeField = 'tenantId';

function systemFields(ref: string, prefix: string): Record<string, FieldNode> {
  return {
    id: { optional: false, access: 'read', kind: 'id', target: ref, prefix },
    createdAt: { optional: false, access: 'read', kind: 'instant' },
    updatedAt: { optional: false, access: 'read', kind: 'instant' },
    archivedAt: { optional: true, access: 'read', kind: 'instant' },
    version: { optional: false, access: 'read', kind: 'integer', wide: false },
  };
}

function relationOf(relation: RelationDescriptor): SurfaceRelation {
  if (relation.through !== undefined) return { kind: 'through', target: relation.target };
  if (relation.kind === 'many') return { kind: 'many', target: relation.target, by: relation.by };
  return { kind: 'one', target: relation.target };
}

function sortedRecord<V>(entries: Iterable<readonly [string, V]>): Record<string, V> {
  return Object.fromEntries([...entries].sort(([left], [right]) => compareCodePoints(left, right)));
}

/** An entity of the surface and the problems met describing it. */
export interface SurfaceEntityResult {
  readonly entity: SurfaceEntity;
  readonly problems: readonly CompositionProblem[];
}

/**
 * The entity of the surface (section 16.2.2): the system fields, then the entity's fields without
 * hidden ones, verifiers and the scope's `tenantId`, each as a field node tagged as the registry
 * tagged it. A field no transport could describe is left out and reported.
 */
export function surfaceEntityOf(
  model: EntityModel,
  prefixOf: (entityRef: string) => string | undefined,
): SurfaceEntityResult {
  const { entry } = model;
  const problems: CompositionProblem[] = [];
  const fields: Record<string, FieldNode> = systemFields(entry.ref, entry.prefix);
  for (const [name, def] of Object.entries(model.fields)) {
    if (def.kind === 'verifier' || def.flags.hidden || name === scopeField) continue;
    try {
      fields[name] = fieldNodeOf(def, {
        declaredBy: entry.origin[name] ?? entry.module,
        tag: entry.descriptor.fields[name]?.tag ?? 1,
        prefixOf,
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      problems.push(
        compositionError('unsurfacedFields', `${entry.ref}.${name}: ${error.message}`, {
          module: entry.module,
          ref: `${entry.ref}.${name}`,
        }),
      );
    }
  }
  const entity: SurfaceEntity = {
    ref: entry.ref,
    module: entry.module,
    name: entry.name,
    prefix: entry.prefix,
    history: entry.descriptor.history,
    tenancy: entry.descriptor.tenancy,
    fields: sortedRecord(Object.entries(fields)),
    relations: sortedRecord(
      Object.entries(entry.descriptor.relations).map(([name, relation]) => [
        name,
        relationOf(relation),
      ]),
    ),
    generated: entry.generated,
    page: { ...entry.page, sortable: [...entry.page.sortable].sort(compareCodePoints) },
    origin: sortedRecord(Object.entries(entry.origin)),
    ...(entry.description === undefined ? {} : { description: entry.description }),
  };
  return { entity, problems };
}
