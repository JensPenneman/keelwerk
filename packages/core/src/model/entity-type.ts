import type { AnyEntity, Entity } from '../dsl/define-entity.ts';

/**
 * The named type of an entity value (decision 103): `export interface Profile extends
 * EntityType<typeof profile> {}`, so declaration files name the entity instead of repeating its structure.
 */
export type EntityType<E extends AnyEntity> = Entity<
  E['prefix'],
  E['fields'],
  E['events'],
  E['history'],
  E['generated'],
  E['relations']
>;
