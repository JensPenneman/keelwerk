import type { AppActionTree, CamelCase, CommandReceipt, Empty } from '@keelwerk/core';
import type {
  TRPCBuiltRouter,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
  TRPCSubscriptionProcedure,
} from '@trpc/server';
import type { TrpcErrorShape } from '../errors/trpc-error-shape.ts';
import type { TrpcFrame } from './trpc-frame.ts';

interface KeelwerkTrpcRoot<Transformer extends boolean> {
  ctx: object;
  meta: object;
  errorShape: TrpcErrorShape;
  transformer: Transformer;
}

/** The members of an action tree leaf (section 4.7) that its procedure reads. */
interface TreeLeaf {
  readonly kind: 'query' | 'command' | 'subscription';
  readonly input: unknown;
  readonly output: unknown;
  readonly execution: unknown;
}

/*
 * An object input gains the resume key, no input is the resume key alone, and any other input stays
 * as it is (the check refuses a non-object foreign input of a resumable action, so a scalar input
 * belongs to a subscription that does not resume).
 */
type SubscriptionInput<I> = I extends object
  ? I & { lastEventId?: string | null }
  : // biome-ignore lint/suspicious/noConfusingVoidType: the action tree writes an empty input as undefined or void
    [I] extends [undefined | void]
    ? undefined | { lastEventId?: string | null }
    : I;

type IsAny<T> = 0 extends 1 & T ? true : false;

/*
 * The event of a subscription as the plain json wire carries it: `void` and `undefined` are written
 * as `null` (`messageOf` sends `frame.event ?? null`), so an event typed `void` is `null` and one
 * typed `string | undefined` is `string | null`. Without this tRPC's own `Serialize` drops the
 * `data` member of a `void` item and makes `data` optional for a union with `undefined`, so a
 * reader that narrowed by `'data' in frame` would see `never` or a plain `string` where the wire
 * sends `null`.
 */
type JsonEvent<O> =
  IsAny<O> extends true
    ? O
    : [O] extends [never]
      ? O
      : // biome-ignore lint/suspicious/noConfusingVoidType: the action tree writes an empty output as undefined or void
        [O] extends [undefined | void]
        ? null
        : undefined extends O
          ? // biome-ignore lint/suspicious/noConfusingVoidType: the same union, with its empty members removed
            Exclude<O, undefined | void> | null
          : O;

type MutationOutput<O, X> = X extends 'sync'
  ? O
  : X extends 'async'
    ? CommandReceipt
    : O | CommandReceipt;

/** The procedure of each kind of leaf; a lookup by `kind` instantiates only the one it names. */
interface ProcedureByKind<A extends TreeLeaf, Transformer extends boolean> {
  query: TRPCQueryProcedure<{ input: A['input']; output: A['output']; meta: object }>;
  command: TRPCMutationProcedure<{
    input: A['input'];
    output: MutationOutput<A['output'], A['execution']>;
    meta: object;
  }>;
  subscription: TRPCSubscriptionProcedure<{
    input: SubscriptionInput<A['input']>;
    output: AsyncIterable<
      TrpcFrame<Transformer extends false ? JsonEvent<A['output']> : A['output']>,
      void,
      unknown
    >;
    meta: object;
  }>;
}

type Procedure<A, Transformer extends boolean> = A extends TreeLeaf
  ? ProcedureByKind<A, Transformer>[A['kind']]
  : never;

/*
 * The empty records of the false branches let the compiler prove the router record constraint on
 * the generic type once, so no use site checks the whole record against it: a client resolves only
 * the procedures it reads.
 */
type TrpcRecord<T, Transformer extends boolean> = {
  [M in keyof T & string as CamelCase<M>]: (T[M] extends { readonly actions: infer As }
    ? { [A in keyof As]: Procedure<As[A], Transformer> }
    : Empty) &
    (T[M] extends { readonly entities: infer Es }
      ? { [E in keyof Es]: { [A in keyof Es[E]]: Procedure<Es[E][A], Transformer> } }
      : Empty);
};

/**
 * The type of the router a client is built against (section 16.7.2), derived from the app's action
 * tree without a router value and without code generation. `Transformer` is `false` for an app that
 * sets the static option `transformer: 'json'`.
 */
export type TrpcRouterOf<App, Transformer extends boolean = true> = TRPCBuiltRouter<
  KeelwerkTrpcRoot<Transformer>,
  TrpcRecord<AppActionTree<App>, Transformer>
>;
