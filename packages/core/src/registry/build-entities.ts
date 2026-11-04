import type { AnyField } from '../fields/field-def.ts';
import type { EntityBehaviour } from '../write-path/entity-behaviour.ts';
import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import { buildEntityDescriptor } from './build-entity-descriptor.ts';
import type { EntityModel } from './entity-model.ts';
import { entityPage } from './entity-page.ts';
import { entitySources } from './entity-sources.ts';
import { generatedActionsOf } from './generated-actions-of.ts';
import type { RuntimeModule } from './runtime-module.ts';
import { tracksOf } from './tracks-of.ts';

/** The entities of the ordered modules with every active contribution and conditional part applied. */
export function buildEntities(
  selection: AppSelection,
  ordered: readonly RuntimeModule[],
  parts: readonly AppliedPart[],
): ReadonlyMap<string, EntityModel> {
  const generators = selection.modules.flatMap((module) => module.generates);
  const tenancyOf = (entityRef: string): string | undefined => {
    const dot = entityRef.indexOf('.');
    return selection.byId.get(entityRef.slice(0, dot))?.entities[entityRef.slice(dot + 1)]?.tenancy;
  };
  const models = new Map<string, EntityModel>();
  for (const module of ordered) {
    for (const [name, entity] of Object.entries(module.entities)) {
      const sources = entitySources(module, name, parts);
      const { descriptor, origin } = buildEntityDescriptor({
        module: module.id,
        name,
        entity,
        sources,
        foreignKeyTo: (entityRef) => tenancyOf(entityRef) === entity.tenancy,
      });
      const fields: Record<string, AnyField> = {};
      const fieldTracks: Record<string, string> = {};
      const defaults: Record<string, unknown> = {};
      for (const source of sources) {
        Object.assign(fields, source.fields);
        for (const [fieldName, def] of Object.entries<AnyField>(source.fields)) {
          fieldTracks[fieldName] = source.track;
          if (def.defaultValue !== undefined) defaults[fieldName] = def.defaultValue;
        }
      }
      const behaviour: EntityBehaviour = {
        defaults,
        evolve: entity.evolve,
        invariant: entity.invariant,
      };
      models.set(descriptor.ref, {
        entry: {
          ref: descriptor.ref,
          module: module.id,
          name,
          prefix: entity.prefix,
          descriptor,
          tracks: tracksOf(descriptor.ref, descriptor.shape),
          generated: generatedActionsOf(entity, generators),
          origin,
          fieldTracks,
          behaviour,
          page: entityPage(fields),
          events: Object.fromEntries(
            Object.entries(entity.events).map(([event, schema]) => [event, schema]),
          ),
        },
        fields,
        tenancy: entity.tenancy,
      });
    }
  }
  return models;
}
