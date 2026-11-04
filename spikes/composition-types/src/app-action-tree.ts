import type { PageOutput, PartTypes, RowOutput } from './action-part.ts';
import type { AllKeys } from './all-keys.ts';
import type { AnyModule } from './any-module.ts';
import type { InsertAt, PatchAt, ReadableRowAt } from './app-entities.ts';
import type { EntityNames } from './base-members.ts';
import type { EntityChange } from './entity-change.ts';
import type { Id } from './id.ts';
import type { HistoryEntry } from './loads-of.ts';
import type { Page } from './page.ts';
import type { ActiveConditionals, ActiveContributions, ById, Ids } from './selection.ts';
import type { TypeAt } from './type-at.ts';
import type { Where } from './where.ts';

interface Generated<K extends string, T> {
  readonly kind: K;
  readonly execution: 'sync';
  readonly '~types'?: T;
}

type ModuleActionDefs<Ms extends readonly AnyModule[], I extends string> =
  | (ById<Ms, I> extends { readonly actions: infer A } ? A : never)
  | (ActiveContributions<Ms> extends infer C
      ? C extends { readonly to: { readonly id: I }; readonly actions: infer A }
        ? A
        : never
      : never)
  | (ActiveConditionals<Ms, ById<Ms, I>> extends infer Cd
      ? Cd extends { readonly actions: infer A }
        ? A
        : never
      : never);
type EntityActionDefs<Ms extends readonly AnyModule[], I extends string, E extends string> =
  | (ById<Ms, I> extends { readonly entities: { readonly [K in E]: { readonly actions: infer A } } }
      ? A
      : never)
  | (ActiveContributions<Ms> extends infer C
      ? C extends {
          readonly to: { readonly id: I };
          readonly entities: { readonly [K in E]: { readonly actions: infer A } };
        }
        ? A
        : never
      : never)
  | (ActiveConditionals<Ms, ById<Ms, I>> extends infer Cd
      ? Cd extends { readonly entities: { readonly [K in E]: { readonly actions: infer A } } }
        ? A
        : never
      : never);

type EntityDef<Ms extends readonly AnyModule[], I extends string, E extends string> =
  ById<Ms, I> extends { readonly entities: { readonly [K in E]: infer D } } ? D : never;
type SetOperations = 'set' | 'create' | 'update' | 'archive' | 'restore';
type BaseGenerated<D> = D extends { readonly history: 'external' }
  ? 'get' | 'query'
  : D extends { readonly history: 'projection' }
    ? 'get' | 'query' | 'changes' | 'queryChanges'
    : 'get' | 'query' | 'changes' | 'queryChanges' | SetOperations;
type OptInGenerated<D> = D extends { readonly generated: { readonly history: true } }
  ? 'history'
  : never;
type SwitchedOff<D> = D extends { readonly generated: infer G }
  ? { [K in keyof G]: G[K] extends false ? (K extends 'set' ? SetOperations : K) : never }[keyof G]
  : never;
type Generators<Ms extends readonly AnyModule[]> = Ms[number] extends infer M
  ? M extends { readonly generates: readonly (infer G)[] }
    ? G
    : never
  : never;
type GeneratedNames<Ms extends readonly AnyModule[], I extends string, E extends string> =
  EntityDef<Ms, I, E> extends infer D
    ? Exclude<
        | BaseGenerated<D>
        | OptInGenerated<D>
        | (D extends { readonly history: 'external' } ? never : Generators<Ms>),
        SwitchedOff<D>
      >
    : never;

type ById2<Ref extends string> = { readonly id: Id<Ref>; readonly ifVersion?: number };
type GeneratedDef<
  N,
  Ms extends readonly AnyModule[],
  I extends string,
  E extends string,
> = N extends 'get'
  ? Generated<
      'query',
      PartTypes<
        { readonly ids: readonly Id<`${I}.${E}`>[] },
        {
          readonly list: readonly ReadableRowAt<Ms, I, E>[];
          readonly notFound: readonly string[];
          readonly state: string;
        },
        never,
        never
      >
    >
  : N extends 'query'
    ? Generated<
        'query',
        PartTypes<
          {
            readonly filter?: Where<ReadableRowAt<Ms, I, E>>;
            readonly first?: number;
            readonly after?: string;
          },
          Page<ReadableRowAt<Ms, I, E>>,
          never,
          never
        >
      >
    : N extends 'changes' | 'queryChanges'
      ? Generated<
          'query',
          PartTypes<
            { readonly since: string },
            {
              readonly created: readonly string[];
              readonly changed: readonly string[];
              readonly archived: readonly string[];
              readonly newState: string;
            },
            never,
            never
          >
        >
      : N extends 'create'
        ? Generated<'command', PartTypes<InsertAt<Ms, I, E>, ReadableRowAt<Ms, I, E>, never, never>>
        : N extends 'update'
          ? Generated<
              'command',
              PartTypes<
                ById2<`${I}.${E}`> & { readonly patch: PatchAt<Ms, I, E> },
                ReadableRowAt<Ms, I, E>,
                never,
                never
              >
            >
          : N extends 'archive' | 'restore'
            ? Generated<
                'command',
                PartTypes<ById2<`${I}.${E}`>, ReadableRowAt<Ms, I, E>, never, never>
              >
            : N extends 'set'
              ? Generated<
                  'command',
                  PartTypes<
                    {
                      readonly create?: readonly InsertAt<Ms, I, E>[];
                      readonly update?: readonly (ById2<`${I}.${E}`> & {
                        readonly patch: PatchAt<Ms, I, E>;
                      })[];
                      readonly archive?: readonly ById2<`${I}.${E}`>[];
                      readonly restore?: readonly ById2<`${I}.${E}`>[];
                    },
                    unknown,
                    never,
                    never
                  >
                >
              : N extends 'history'
                ? Generated<
                    'query',
                    PartTypes<
                      { readonly id: Id<`${I}.${E}`> },
                      Page<HistoryEntry<ReadableRowAt<Ms, I, E>>>,
                      never,
                      never
                    >
                  >
                : N extends 'watch'
                  ? Generated<
                      'subscription',
                      PartTypes<
                        {
                          readonly filter?: Where<ReadableRowAt<Ms, I, E>>;
                          readonly after?: string;
                        },
                        EntityChange<ReadableRowAt<Ms, I, E>>,
                        never,
                        EntityChange<ReadableRowAt<Ms, I, E>>
                      >
                    >
                  : never;

type ModuleActionNames<Ms extends readonly AnyModule[], I extends string> = AllKeys<
  ModuleActionDefs<Ms, I>
> &
  string;
type EntityActionNames<Ms extends readonly AnyModule[], I extends string, E extends string> =
  | GeneratedNames<Ms, I, E>
  | (AllKeys<EntityActionDefs<Ms, I, E>> & string);
type EntityActionDef<
  Ms extends readonly AnyModule[],
  I extends string,
  E extends string,
  N extends string,
> =
  N extends GeneratedNames<Ms, I, E>
    ? GeneratedDef<N, Ms, I, E>
    : TypeAt<EntityActionDefs<Ms, I, E>, N>;

type CommandsIn<Defs> = {
  [N in AllKeys<Defs> & string]: TypeAt<Defs, N> extends { readonly kind: 'command' } ? N : never;
}[AllKeys<Defs> & string];

type TypesOf<D> = D extends { readonly '~types'?: infer T } ? NonNullable<T> : never;
type ResolveOutput<O, Ms extends readonly AnyModule[]> =
  O extends RowOutput<`${infer I}.${infer E}`>
    ? ReadableRowAt<Ms, I, E>
    : O extends PageOutput<`${infer I}.${infer E}`>
      ? Page<ReadableRowAt<Ms, I, E>>
      : O;

/** A leaf of the action tree: kind, input, output, errors, events and the effective execution mode. */
export type Leaf<D, Ref extends string, X, Ms extends readonly AnyModule[]> = D extends {
  readonly kind: infer K;
  readonly execution: infer Xd;
}
  ? TypesOf<D> extends PartTypes<infer In, infer Out, infer Er, infer Ev>
    ? {
        readonly kind: K;
        readonly input: In;
        readonly output: ResolveOutput<Out, Ms>;
        readonly errors: Er;
        readonly events: Ev;
        readonly execution: Ref extends keyof X ? X[Ref] : Xd;
      }
    : never
  : never;

/** Module, then entity, then action (section 4.7); app actions under `app`. */
export type AppActionTreeOf<Ms extends readonly AnyModule[], A, X> = {
  readonly [I in Ids<Ms>]: {
    readonly actions: {
      readonly [N in ModuleActionNames<Ms, I>]: Leaf<
        TypeAt<ModuleActionDefs<Ms, I>, N>,
        `${I}.${N}`,
        X,
        Ms
      >;
    };
    readonly entities: {
      readonly [E in EntityNames<ById<Ms, I>>]: {
        readonly [N in EntityActionNames<Ms, I, E>]: Leaf<
          EntityActionDef<Ms, I, E, N>,
          `${I}.${E}.${N}`,
          X,
          Ms
        >;
      };
    };
  };
} & {
  readonly app: {
    readonly actions: { readonly [N in keyof A & string]: Leaf<A[N], `app.${N}`, X, Ms> };
    readonly entities: {};
  };
};

/** Every action reference of a selection. */
export type ActionRefsOf<Ms extends readonly AnyModule[], A> =
  | {
      [I in Ids<Ms>]:
        | {
            [E in EntityNames<ById<Ms, I>>]: `${I}.${E}.${EntityActionNames<Ms, I, E>}`;
          }[EntityNames<ById<Ms, I>>]
        | `${I}.${ModuleActionNames<Ms, I>}`;
    }[Ids<Ms>]
  | `app.${keyof A & string}`;

/** Every command reference of a selection: what an execution override may name. */
export type CommandRefsOf<Ms extends readonly AnyModule[], A> =
  | {
      [I in Ids<Ms>]:
        | {
            [E in EntityNames<
              ById<Ms, I>
            >]: `${I}.${E}.${Extract<GeneratedNames<Ms, I, E>, SetOperations> | CommandsIn<EntityActionDefs<Ms, I, E>>}`;
          }[EntityNames<ById<Ms, I>>]
        | `${I}.${CommandsIn<ModuleActionDefs<Ms, I>>}`;
    }[Ids<Ms>]
  | `app.${CommandsIn<A>}`;

/** The action tree of an app. */
export type AppActionTree<P> = P extends { readonly tree: infer T } ? T : never;

/** The union of every action reference of an app. */
export type ActionRef<P> = P extends { readonly actions: infer R } ? R : never;
