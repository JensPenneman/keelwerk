import type { HistoryEntry } from '../contexts/history-entry.ts';
import type { Id } from '../ids/id.ts';
import type { Empty } from '../types/empty.ts';
import type { PageOutput, PartTypes, RowOutput } from './action-part.ts';
import type { AllKeys } from './all-keys.ts';
import type { AnyModule } from './any-module.ts';
import type { ReadableRowAt } from './app-entities.ts';
import type { EntityNames } from './entities-of.ts';
import type { EntityChange } from './entity-change.ts';
import type { GeneratedActionNames, SetOperations } from './generated-action-names.ts';
import type { InsertAt } from './insert-at.ts';
import type { InstanceInput } from './instance-input.ts';
import type { Page } from './page.ts';
import type { PatchAt } from './patch-at.ts';
import type { ActiveConditionals, ById, ContributionsTo, Ids } from './selection.ts';
import type { TypeAt } from './type-at.ts';
import type { Where } from './where.ts';

interface Generated<K extends string, T> {
  readonly kind: K;
  readonly execution: 'sync';
  readonly '~types'?: T;
}

type ModuleActionDefs<Ms extends readonly AnyModule[], I extends string> =
  | (ById<Ms, I> extends { readonly actions: infer A } ? A : never)
  | (ContributionsTo<Ms, I> extends infer C
      ? C extends { readonly actions: infer A }
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
  | (ContributionsTo<Ms, I> extends infer C
      ? C extends {
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
                InstanceInput<`${I}.${E}`> & { readonly patch: PatchAt<Ms, I, E> },
                ReadableRowAt<Ms, I, E>,
                never,
                never
              >
            >
          : N extends 'archive' | 'restore'
            ? Generated<
                'command',
                PartTypes<InstanceInput<`${I}.${E}`>, ReadableRowAt<Ms, I, E>, never, never>
              >
            : N extends 'set'
              ? Generated<
                  'command',
                  PartTypes<
                    {
                      readonly create?: readonly InsertAt<Ms, I, E>[];
                      readonly update?: readonly (InstanceInput<`${I}.${E}`> & {
                        readonly patch: PatchAt<Ms, I, E>;
                      })[];
                      readonly archive?: readonly InstanceInput<`${I}.${E}`>[];
                      readonly restore?: readonly InstanceInput<`${I}.${E}`>[];
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
  | GeneratedActionNames<Ms, I, E>
  | (AllKeys<EntityActionDefs<Ms, I, E>> & string);
type EntityActionDef<
  Ms extends readonly AnyModule[],
  I extends string,
  E extends string,
  N extends string,
> =
  N extends GeneratedActionNames<Ms, I, E>
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
type Leaf<D, Ref extends string, X, Ms extends readonly AnyModule[]> = D extends {
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
    readonly entities: Empty;
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
            >]: `${I}.${E}.${Extract<GeneratedActionNames<Ms, I, E>, SetOperations> | CommandsIn<EntityActionDefs<Ms, I, E>>}`;
          }[EntityNames<ById<Ms, I>>]
        | `${I}.${CommandsIn<ModuleActionDefs<Ms, I>>}`;
    }[Ids<Ms>]
  | `app.${CommandsIn<A>}`;

/** The action tree of an app. */
export type AppActionTree<P> = P extends { readonly '~types'?: infer T }
  ? NonNullable<T> extends { readonly tree: infer Tree }
    ? Tree
    : never
  : never;
