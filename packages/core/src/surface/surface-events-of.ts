import { compareCodePoints } from '../conditions/compare-code-points.ts';
import { compositionError } from '../registry/composition-error.ts';
import type { CompositionProblem } from '../registry/composition-problem.ts';
import type { EntityModel } from '../registry/entity-model.ts';
import { schemaNodeOf } from './schema-node-of.ts';
import type { SurfaceEvent } from './surface-event.ts';

const generatedEvents: readonly string[] = ['created', 'changed', 'archived', 'restored'];

/** The events of the surface and the problems met describing them. */
export interface SurfaceEventsResult {
  readonly events: readonly SurfaceEvent[];
  readonly problems: readonly CompositionProblem[];
}

/**
 * The events of the surface (section 16.2.2), sorted by entity then name: the generated ones of
 * every chain entity (`erased` when the entity holds personal data) and the entities' domain
 * events with their data nodes.
 */
export function surfaceEventsOf(
  models: Iterable<EntityModel>,
  prefixOf: (entityRef: string) => string | undefined,
): SurfaceEventsResult {
  const events: SurfaceEvent[] = [];
  const problems: CompositionProblem[] = [];
  for (const { entry, fields } of models) {
    if (entry.descriptor.history === 'chain') {
      const personal =
        entry.descriptor.dataSubject !== null ||
        Object.values(fields).some((def) => def.flags.personal !== false);
      for (const name of personal ? [...generatedEvents, 'erased'] : generatedEvents) {
        events.push({ entity: entry.ref, name, generated: true });
      }
    }
    for (const [name, schema] of Object.entries(entry.events)) {
      if (schema === null) {
        events.push({ entity: entry.ref, name, generated: false });
        continue;
      }
      const result = schemaNodeOf(schema, { declaredBy: entry.module, prefixOf });
      if (result.problem !== undefined) {
        problems.push(
          compositionError('unsurfacedSchemas', `${entry.ref}.${name}: ${result.problem}`, {
            module: entry.module,
            ref: `${entry.ref}.${name}`,
          }),
        );
      }
      events.push({ entity: entry.ref, name, generated: false, data: result.node });
    }
  }
  return {
    events: events.sort(
      (left, right) =>
        compareCodePoints(left.entity, right.entity) || compareCodePoints(left.name, right.name),
    ),
    problems,
  };
}
