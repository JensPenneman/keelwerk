import { errors } from '../errors/errors.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StateToken } from '../events/state-token.ts';
import type { LiveEffectsPlan } from './live-effects-plan.ts';
import type { LiveEffectsSource } from './live-effects-source.ts';
import type { LiveEntitySource } from './live-entity-source.ts';
import type { LivePokesPlan } from './live-pokes-plan.ts';
import type { LiveSourcePlan } from './live-source-plan.ts';

interface Description {
  readonly kind: 'liveSource';
  readonly source?: unknown;
  readonly map?: unknown;
}

function isDescription(value: unknown): value is Description {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'liveSource';
}

function isEntitySource(value: unknown): value is LiveEntitySource {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'entity';
}

function isEffectsSource(value: unknown): value is LiveEffectsSource {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'effects';
}

function isPokesSource(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'pokes';
}

function internalSource(): KeelwerkError {
  return errors.internal('A subscription source is not a description the live hub can run.');
}

/**
 * The plan of a source description (7.9.2): the maps are unwrapped (innermost applied first) down
 * to the leaf, which must be the changes of an entity, the pending effects of an effect or the pokes
 * of the session's scope. Any other description is `internal`.
 */
export function planLiveSource(
  description: unknown,
): LiveSourcePlan | LivePokesPlan | LiveEffectsPlan {
  const maps: ((item: unknown) => unknown)[] = [];
  let leaf: unknown = description;
  while (isDescription(leaf) && leaf.map !== undefined) {
    if (typeof leaf.map !== 'function') throw internalSource();
    maps.push(leaf.map as (item: unknown) => unknown);
    leaf = leaf.source;
  }
  const entity = isDescription(leaf) ? leaf.source : undefined;
  if (isPokesSource(entity)) return { kind: 'pokes', after: undefined, maps: maps.reverse() };
  if (isEffectsSource(entity)) {
    return {
      kind: 'effects',
      entity: 'core.effect',
      effect: entity.effect,
      plain: entity.plain,
      entry: entity.entry,
      where: entity.where,
      input: { from: 'beginning' },
      after: entity.after as StateToken | undefined,
      maps: maps.reverse(),
    };
  }
  if (!isEntitySource(entity)) throw internalSource();
  const { options } = entity;
  return {
    entity: entity.entity,
    input: {
      ...(options.where === undefined ? {} : { filter: options.where }),
      ...(options.ids === undefined ? {} : { ids: options.ids }),
      ...(options.fields === undefined ? {} : { fields: options.fields }),
      ...(options.includeArchived === undefined
        ? {}
        : { includeArchived: options.includeArchived }),
      ...(options.from === undefined ? {} : { from: options.from }),
    },
    after: options.after as StateToken | undefined,
    maps: maps.reverse(),
  };
}
