import type { AnyField } from '../fields/field-def.ts';
import type { AnyRelation } from '../fields/relation.ts';
import type { Shape, ShapeFields } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { Where } from '../model/where.ts';
import type { Empty } from '../types/empty.ts';
import { refuseEntityDefinition } from './refuse-entity-definition.ts';

type EventPayloadOf<S> = S extends Shape<infer F> ? ShapeValue<F, string, 'stored'> : never;

/** The field names a list of entity indexes names. */
type IndexedNames<I extends readonly { readonly fields: readonly string[] }[]> =
  I[number]['fields'][number];

/** How an entity keeps its history (section 6.6). */
export type HistoryMode = 'chain' | 'state' | 'projection' | 'external';

/** Where an entity's rows live (section 4.2). */
export type Tenancy = 'tenant' | 'backend' | 'deployment' | 'invocation';

/** Switches for generated actions (section 6.7). */
export interface GeneratedOptions {
  readonly get?: boolean;
  readonly query?: boolean;
  readonly changes?: boolean;
  readonly queryChanges?: boolean;
  readonly set?: boolean;
  readonly history?: boolean;
  readonly watch?: boolean;
}

/** Domain event payload shapes, by event name. */
export type EventShapes = { readonly [name: string]: Shape };

/** Relations, by name. */
export type Relations = { readonly [name: string]: AnyRelation };

/** The state an `evolve` function folds: the declared fields as stored. */
export type EntityState<F> = ShapeValue<F, string, 'stored'>;

/** An index declaration over the entity's own fields. */
export interface EntityIndex<F> {
  readonly fields: readonly (keyof F & string)[];
  readonly unique?: boolean;
  readonly where?: Where<EntityState<F>, F>;
}

/** A search index over the entity's own fields (sections 14.3.3 and 14.7.9.9). */
export interface SearchIndex {
  readonly name: string;
  readonly fields: readonly string[];
  readonly keys?: 'tenant' | 'subject';
  readonly languages?: readonly string[];
}

/**
 * The fields after the entity's indexes are applied: a personal field an index names gains `eq`
 * and the indexed flag, as `.index()` would (section 14.7.9.2).
 */
export type IndexedFields<F extends ShapeFields, N extends string> = {
  readonly [K in keyof F]: K extends N
    ? F[K]['flags']['personal'] extends false
      ? F[K]
      : ReturnType<F[K]['index']>
    : F[K];
};

/** The literal `defineEntity` takes (section 4.2). */
export interface EntityDefinition<
  P extends string,
  F extends ShapeFields,
  Ev extends EventShapes,
  H extends HistoryMode,
  G extends GeneratedOptions,
  Rel extends Relations,
  I extends readonly EntityIndex<F>[] = readonly EntityIndex<F>[],
> {
  readonly prefix: P;
  readonly dataSubject?: (keyof F & string) | 'id';
  readonly fields: F;
  readonly relations?: Rel;
  readonly indexes?: I;
  readonly searchIndexes?: readonly SearchIndex[];
  readonly history?: H;
  readonly reason?: string;
  readonly tenancy?: Tenancy;
  readonly partition?: keyof F & string;
  readonly events?: Ev;
  readonly evolve?: {
    readonly [K in keyof Ev]: (
      state: EntityState<F>,
      event: EventPayloadOf<Ev[K]>,
    ) => EntityState<F>;
  };
  readonly invariant?: (row: EntityState<F>) => boolean;
  readonly generated?: G;
  readonly retention?: { readonly suggest: string };
}

/** An entity value: everything the type model reads, with literal types, and the definition's remaining members. */
export interface Entity<
  P extends string,
  F extends ShapeFields,
  Ev extends EventShapes,
  H extends HistoryMode,
  G extends GeneratedOptions,
  Rel extends Relations,
> {
  readonly kind: 'entity';
  readonly prefix: P;
  readonly fields: F;
  readonly events: Ev;
  readonly history: H;
  readonly generated: G;
  readonly relations: Rel;
  readonly dataSubject: string | null;
  readonly indexes: readonly EntityIndex<F>[];
  readonly searchIndexes: readonly SearchIndex[];
  readonly reason: string | null;
  readonly tenancy: Tenancy;
  readonly partition: string | null;
  readonly evolve: { readonly [name: string]: (state: never, event: never) => unknown };
  readonly invariant: ((row: never) => boolean) | null;
  readonly retention: { readonly suggest: string } | null;
}

/**
 * Any entity, written out structurally rather than as `Entity<string, ShapeFields, ...>`: an index's
 * `where` mentions the fields in a position TypeScript measures as invariant, and that measurement
 * depends on which other files the program holds, so an instantiation of `Entity` is not a stable
 * supertype of every concrete entity.
 */
export interface AnyEntity {
  readonly kind: 'entity';
  readonly prefix: string;
  readonly fields: ShapeFields;
  readonly events: EventShapes;
  readonly history: HistoryMode;
  readonly generated: GeneratedOptions;
  readonly relations: Relations;
  readonly dataSubject: string | null;
  readonly indexes: readonly {
    readonly fields: readonly string[];
    readonly unique?: boolean;
    readonly where?: unknown;
  }[];
  readonly searchIndexes: readonly SearchIndex[];
  readonly reason: string | null;
  readonly tenancy: Tenancy;
  readonly partition: string | null;
  readonly evolve: { readonly [name: string]: (state: never, event: never) => unknown };
  readonly invariant: ((row: never) => boolean) | null;
  readonly retention: { readonly suggest: string } | null;
}

/**
 * Defines an entity; `history` defaults to 'chain' and `tenancy` to 'tenant'. The defaulted
 * parameters come back through `NoInfer`, so an entity defined inline inside another
 * const-generic call keeps its defaults (decision 100).
 */
export function defineEntity<
  const P extends string,
  const F extends ShapeFields,
  const Ev extends EventShapes = Empty,
  const H extends HistoryMode = 'chain',
  const G extends GeneratedOptions = Empty,
  const Rel extends Relations = Empty,
  const I extends readonly EntityIndex<F>[] = readonly [],
>(
  definition: EntityDefinition<P, F, Ev, H, G, Rel, I>,
): Entity<P, IndexedFields<F, IndexedNames<I>>, NoInfer<Ev>, NoInfer<H>, NoInfer<G>, NoInfer<Rel>> {
  refuseEntityDefinition(definition);
  const indexed = new Set<string>((definition.indexes ?? []).flatMap((index) => index.fields));
  const fields = Object.fromEntries(
    Object.entries<AnyField>(definition.fields).map(([name, member]) => [
      name,
      indexed.has(name) && member.flags.personal !== false ? member.index() : member,
    ]),
  ) as IndexedFields<F, IndexedNames<I>>;
  // The indexes were written against `F`; `fields` only adds flags to the fields they name,
  // so they read the same against the indexed fields.
  type Indexed = IndexedFields<F, IndexedNames<I>>;
  const indexes = (definition.indexes ?? []) as unknown as readonly EntityIndex<Indexed>[];
  return {
    kind: 'entity',
    prefix: definition.prefix,
    fields,
    events: definition.events ?? ({} as Ev),
    history: definition.history ?? ('chain' as H),
    generated: definition.generated ?? ({} as G),
    relations: definition.relations ?? ({} as Rel),
    dataSubject: definition.dataSubject ?? null,
    indexes,
    searchIndexes: definition.searchIndexes ?? [],
    reason: definition.reason ?? null,
    tenancy: definition.tenancy ?? 'tenant',
    partition: definition.partition ?? null,
    evolve: definition.evolve ?? {},
    invariant: definition.invariant ?? null,
    retention: definition.retention ?? null,
  };
}
