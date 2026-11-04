import type { Relations } from '../dsl/define-entity.ts';
import type { ShapeFields } from '../fields/shape.ts';
import type { AppliedPart } from './applied-part.ts';
import type { RuntimeModule } from './runtime-module.ts';

/** One source of an entity's fields and relations: its own definition, a conditional part or a contribution. */
export interface EntitySource {
  /** The track id (section 14.6.1): the module id for the entity's own fields. */
  readonly track: string;
  /** The module whose `own` references the source's fields resolve against. */
  readonly declaredBy: string;
  /** The module that contributed; null for the owner's own track and its conditional parts. */
  readonly contributedBy: string | null;
  readonly fields: ShapeFields;
  readonly relations: Relations;
}

/**
 * The sources of one entity in track order: its own definition, the active conditional parts of the
 * owner, then the active contributions in module order (the order of `parts`).
 */
export function entitySources(
  module: RuntimeModule,
  entity: string,
  parts: readonly AppliedPart[],
): readonly EntitySource[] {
  const own = module.entities[entity];
  const sources: EntitySource[] = [];
  if (own !== undefined) {
    sources.push({
      track: module.id,
      declaredBy: module.id,
      contributedBy: null,
      fields: own.fields,
      relations: own.relations,
    });
  }
  for (const kind of ['conditional', 'contribution'] as const) {
    for (const part of parts) {
      const patch = part.entities[entity];
      if (part.kind === kind && part.active && part.target === module.id && patch !== undefined) {
        sources.push({
          track: part.trackId,
          declaredBy: part.declaredBy.id,
          contributedBy: kind === 'contribution' ? part.declaredBy.id : null,
          fields: patch.fields,
          relations: patch.relations,
        });
      }
    }
  }
  return sources;
}
