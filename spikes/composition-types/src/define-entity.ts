import type { AnyRelation } from './relation.ts';
import type { Shape, ShapeFields } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';
import type { Where } from './where.ts';

type EventPayloadOf<S> = S extends Shape<infer F> ? ShapeValue<F, string, 'stored'> : never;

/** How an entity keeps its history (section 6.6). */
export type HistoryMode = 'chain' | 'state' | 'projection' | 'external';

/** The closed, core-known set of generator templates filled by modules (section 4.7). */
export type GeneratorTemplate = 'watch';

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
export interface IndexSpec<F> {
  readonly fields: readonly (keyof F & string)[];
  readonly unique?: boolean;
  readonly where?: Where<EntityState<F>>;
}

/** The literal `defineEntity` takes (section 4.2). */
export interface EntityDefinition<
  P extends string,
  F extends ShapeFields,
  Ev extends EventShapes,
  H extends HistoryMode,
  G extends GeneratedOptions,
  Rel extends Relations,
> {
  readonly prefix: P;
  readonly dataSubject?: (keyof F & string) | 'id';
  readonly fields: F;
  readonly relations?: Rel;
  readonly indexes?: readonly IndexSpec<F>[];
  readonly searchIndexes?: readonly object[];
  readonly history?: H;
  readonly reason?: string;
  readonly tenancy?: 'tenant' | 'backend' | 'deployment';
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

/** An entity value: everything the type model reads, with literal types. */
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
}

/** Any entity. */
export type AnyEntity = Entity<
  string,
  ShapeFields,
  EventShapes,
  HistoryMode,
  GeneratedOptions,
  Relations
>;

/** Defines an entity; `history` defaults to 'chain'. */
export function defineEntity<
  const P extends string,
  const F extends ShapeFields,
  const Ev extends EventShapes = {},
  const H extends HistoryMode = 'chain',
  const G extends GeneratedOptions = {},
  const Rel extends Relations = {},
>(
  definition: EntityDefinition<P, F, Ev, H, G, Rel>,
): Entity<P, F, NoInfer<Ev>, NoInfer<H>, NoInfer<G>, NoInfer<Rel>> {
  return {
    kind: 'entity',
    prefix: definition.prefix,
    fields: definition.fields,
    events: definition.events ?? ({} as Ev),
    history: definition.history ?? ('chain' as H),
    generated: definition.generated ?? ({} as G),
    relations: definition.relations ?? ({} as Rel),
  };
}
