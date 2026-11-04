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

function relationThrough(): RelationThroughTo {
  function to<const M extends RefModule, const E extends EntityNamesOf<M>>(
    module: M,
    entity: E,
    keys: ThroughKeys,
  ): ThroughRelation<AbsoluteRef<M['id'], E>> {
    return {
      kind: 'relation',
      cardinality: 'many',
      target: { module: module.id, entity },
      keys: { by: keys.by, to: keys.to },
      through: { entity: keys.join, via: keys.via },
    };
  }
  function own<const E extends string>(entity: E, keys: ThroughKeys): ThroughRelation<OwnRef<E>> {
    return {
      kind: 'relation',
      cardinality: 'many',
      target: { own: true, entity },
      keys: { by: keys.by, to: keys.to },
      through: { entity: keys.join, via: keys.via },
    };
  }
  return Object.assign(to, { own });
}

/** The key pair of a relation: the field on the related rows and the field it matches here. */
export interface RelationKeys {
  readonly by: string;
  readonly to: string;
}

/**
 * The second hop of a many-to-many relation (section 6.3): the join entity the declaring module
 * owns, and the field of its rows that references the target. The relation's `keys` name the first
 * hop: `by` is the join field that matches the field `to` of the declaring row.
 */
export interface RelationThrough {
  /** An entity of the declaring module whose rows pair the two sides. */
  readonly entity: string;
  /** The field of the join rows that holds the target's id. */
  readonly via: string;
}

/** The keys of `relation.through`: the first hop as `RelationKeys`, and the join field that reaches the target. */
export interface ThroughKeys extends RelationKeys {
  /** The own entity that joins both sides. */
  readonly join: string;
  /** The field of the join rows that references the target entity's `id`. */
  readonly via: string;
}

/** A relation to another entity (section 6.3). */
export interface Relation<C extends 'one' | 'many', T extends AbsoluteRef | OwnRef> {
  readonly kind: 'relation';
  readonly cardinality: C;
  readonly target: T;
  readonly keys: RelationKeys;
  /** Set by `relation.through`. */
  readonly through?: RelationThrough;
}

/** A many-to-many relation through a join entity. */
export interface ThroughRelation<T extends AbsoluteRef | OwnRef> extends Relation<'many', T> {
  readonly through: RelationThrough;
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

/** `relation.through`: many-to-many through a join entity of the declaring module. */
export interface RelationThroughTo {
  <const M extends RefModule, const E extends EntityNamesOf<M>>(
    module: M,
    entity: E,
    keys: ThroughKeys,
  ): ThroughRelation<AbsoluteRef<M['id'], E>>;
  own<const E extends string>(entity: E, keys: ThroughKeys): ThroughRelation<OwnRef<E>>;
}

/** The relation builders. */
export interface RelationBuilders {
  readonly one: RelationTo<'one'>;
  readonly many: RelationTo<'many'>;
  readonly through: RelationThroughTo;
}

/** `relation.many.own('credential', { by: 'subject', to: 'id' })` and its siblings. */
export const relation: RelationBuilders = {
  one: relationTo('one'),
  many: relationTo('many'),
  through: relationThrough(),
};
