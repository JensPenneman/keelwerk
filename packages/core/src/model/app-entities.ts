import type { AbsoluteRef, FieldDef, FieldRef, OwnRef } from '../fields/field-def.ts';
import type { FieldFlags } from '../fields/field-flags.ts';
import type { SystemFields } from '../fields/system-fields.ts';
import type { Id } from '../ids/id.ts';
import type { FieldKind } from '../storage/field-kind.ts';
import type { AnyModule } from './any-module.ts';
import type { EntityNames } from './entities-of.ts';
import type { Prettify } from './prettify.ts';
import type { RowOf } from './row-of.ts';
import type { ActiveConditionals, ActiveContributions, ById, Ids } from './selection.ts';
import type { UnionToIntersection } from './union-to-intersection.ts';

/** Own references name an entity of the declaring or contributing module; resolved per source. */
type ResolveFields<F, Owner extends string> = {
  readonly [K in keyof F]: F[K] extends FieldDef<
    unknown,
    infer Fl extends FieldFlags,
    infer R extends FieldRef,
    infer Kd extends FieldKind
  >
    ? R extends OwnRef<infer E>
      ? FieldDef<Id<`${Owner}.${E}`>, Fl, AbsoluteRef<Owner, E>, Kd>
      : F[K]
    : never;
};

type OwnSource<Ms extends readonly AnyModule[], I extends string, E extends string> =
  ById<Ms, I> extends { readonly entities: { readonly [K in E]: { readonly fields: infer F } } }
    ? { readonly source: `own:${I}`; readonly fields: ResolveFields<F, I> }
    : never;
type ConditionalSources<Ms extends readonly AnyModule[], I extends string, E extends string> =
  ActiveConditionals<Ms, ById<Ms, I>> extends infer Cd
    ? Cd extends {
        readonly key: infer Key extends string;
        readonly entities: { readonly [K in E]: { readonly fields: infer F } };
      }
      ? { readonly source: `conditional:${I}[${Key}]`; readonly fields: ResolveFields<F, I> }
      : never
    : never;
type ContributedSources<Ms extends readonly AnyModule[], I extends string, E extends string> =
  ActiveContributions<Ms> extends infer C
    ? C extends {
        readonly to: { readonly id: I };
        readonly from: infer From extends string;
        readonly entities: { readonly [K in E]: { readonly fields: infer F } };
      }
      ? { readonly source: `contribution:${From}`; readonly fields: ResolveFields<F, From> }
      : never
    : never;

/** A row of a selection: system fields and every active field, hidden fields excluded. */
type RowAt<Ms extends readonly AnyModule[], I extends string, E extends string> = Prettify<
  SystemFields<`${I}.${E}`> & RowOf<EntityFields<Ms, I, E>, I, 'dependency'>
>;

/** Every source of fields of one entity: own, active conditional parts, active contributions. */
export type FieldSources<Ms extends readonly AnyModule[], I extends string, E extends string> =
  | OwnSource<Ms, I, E>
  | ConditionalSources<Ms, I, E>
  | ContributedSources<Ms, I, E>;

/** The fields of one entity in a selection, own references resolved. */
export type EntityFields<
  Ms extends readonly AnyModule[],
  I extends string,
  E extends string,
> = UnionToIntersection<FieldSources<Ms, I, E>['fields']>;

/** A row as a transport or client receives it: maskable fields optional (section 8.1). */
export type ReadableRowAt<
  Ms extends readonly AnyModule[],
  I extends string,
  E extends string,
> = Prettify<SystemFields<`${I}.${E}`> & RowOf<EntityFields<Ms, I, E>, I, 'readable'>>;

/** The rows of a selection, per module and entity. */
export type AppEntitiesOf<Ms extends readonly AnyModule[]> = {
  readonly [I in Ids<Ms>]: { readonly [E in EntityNames<ById<Ms, I>>]: RowAt<Ms, I, E> };
};

/** The rows of an app, per module and entity, system fields included. */
export type AppEntities<P> = P extends { readonly '~types'?: infer T }
  ? NonNullable<T> extends { readonly entities: infer En }
    ? En
    : never
  : never;
