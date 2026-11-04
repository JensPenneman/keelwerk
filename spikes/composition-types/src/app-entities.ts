import type { AnyModule } from './any-module.ts';
import type { EntityNames } from './base-members.ts';
import type { AbsoluteRef, FieldDef, FieldFlags, FieldKind, FieldRef, OwnRef } from './field.ts';
import type { Id } from './id.ts';
import type { RowOf } from './module-rows.ts';
import type { Prettify } from './prettify.ts';
import type { ActiveConditionals, ActiveContributions, ById, Ids } from './selection.ts';
import type { SystemFields } from './system-fields.ts';
import type { UnionToIntersection } from './union-to-intersection.ts';
import type { InsertOf, OfflinePatchOf, PatchOf } from './write-shapes.ts';

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
type NonHidden<F> = {
  [K in keyof F as F[K] extends { readonly flags: { readonly hidden: true } } ? never : K]: F[K];
};
type ModulesOf<P> = P extends { readonly modules: infer Ms extends readonly AnyModule[] }
  ? Ms
  : never;
type FieldsAt<P, Ref> = Ref extends `${infer I}.${infer E}`
  ? EntityFields<ModulesOf<P>, I, E>
  : never;

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

/** A row of a selection: system fields and every active field, hidden fields excluded. */
export type RowAt<Ms extends readonly AnyModule[], I extends string, E extends string> = Prettify<
  SystemFields<`${I}.${E}`> & RowOf<EntityFields<Ms, I, E>, I, 'dependency'>
>;

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
export type AppEntities<P> = P extends { readonly entities: infer En } ? En : never;

/** One row type of an app: `Row<Portal, 'accounts.profile'>`. */
export type Row<P, Ref extends string> = Ref extends `${infer M}.${infer E}`
  ? AppEntities<P> extends infer En
    ? M extends keyof En
      ? E extends keyof En[M]
        ? En[M][E]
        : never
      : never
    : never
  : never;

/** A row as clients receive it. Section 8.1 writes `Readable<R>`; the maskable set needs the fields, so it takes the app and reference. */
export type Readable<P, Ref extends string> = Ref extends `${infer I}.${infer E}`
  ? ReadableRowAt<ModulesOf<P>, I, E>
  : never;

/** The insert shape of an app's entity (section 14.8.1). */
export type Insert<P, Ref extends string> = InsertOf<NonHidden<FieldsAt<P, Ref>>>;

/** The patch shape of an app's entity. */
export type Patch<P, Ref extends string> = PatchOf<NonHidden<FieldsAt<P, Ref>>>;

/** The patch an offline mutation may carry: exclusive and unique fields excluded. */
export type OfflinePatch<P, Ref extends string> = OfflinePatchOf<NonHidden<FieldsAt<P, Ref>>>;

/** The insert shape of an entity of a selection. */
export type InsertAt<
  Ms extends readonly AnyModule[],
  I extends string,
  E extends string,
> = InsertOf<NonHidden<EntityFields<Ms, I, E>>>;

/** The patch shape of an entity of a selection. */
export type PatchAt<Ms extends readonly AnyModule[], I extends string, E extends string> = PatchOf<
  NonHidden<EntityFields<Ms, I, E>>
>;

/** A reference as `module.entity`, for the derived types above. */
export type EntityRef<Ms extends readonly AnyModule[]> = {
  [I in Ids<Ms>]: `${I}.${EntityNames<ById<Ms, I>>}`;
}[Ids<Ms>];
