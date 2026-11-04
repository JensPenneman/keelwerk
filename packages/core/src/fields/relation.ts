import type { AbsoluteRef, OwnRef } from './field-def.ts';
import type { EntityNamesOf, RefModule } from './ref-module.ts';

function relationTo<C extends 'one' | 'many'>(cardinality: C): RelationTo<C> {
  function to<const M extends RefModule, const E extends EntityNamesOf<M>>(
    module: M,
    entity: E,
    keys: RelationKeys,
  ): Relation<C, AbsoluteRef<M['id'], E>> {
    return { kind: 'relation', cardinality, target: { module: module.id, entity }, keys };
  }
  function own<const E extends string>(entity: E, keys: RelationKeys): Relation<C, OwnRef<E>> {
    return { kind: 'relation', cardinality, target: { own: true, entity }, keys };
  }
  return Object.assign(to, { own });
}

/** The key pair of a relation: the field on the related rows and the field it matches here. */
export interface RelationKeys {
  readonly by: string;
  readonly to: string;
}

/** A relation to another entity (section 6.3). */
export interface Relation<C extends 'one' | 'many', T extends AbsoluteRef | OwnRef> {
  readonly kind: 'relation';
  readonly cardinality: C;
  readonly target: T;
  readonly keys: RelationKeys;
}

/** Any relation. */
export type AnyRelation = Relation<'one' | 'many', AbsoluteRef | OwnRef>;

/** Relations of one cardinality: to another module's entity, or to an own entity. */
export interface RelationTo<C extends 'one' | 'many'> {
  <const M extends RefModule, const E extends EntityNamesOf<M>>(
    module: M,
    entity: E,
    keys: RelationKeys,
  ): Relation<C, AbsoluteRef<M['id'], E>>;
  own<const E extends string>(entity: E, keys: RelationKeys): Relation<C, OwnRef<E>>;
}

/** The relation builders. */
export interface RelationBuilders {
  readonly one: RelationTo<'one'>;
  readonly many: RelationTo<'many'>;
}

/** `relation.many.own('credential', { by: 'subject', to: 'id' })` and its siblings. */
export const relation: RelationBuilders = { one: relationTo('one'), many: relationTo('many') };
