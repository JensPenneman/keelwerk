import type {
  AppActionTree,
  CamelCase,
  CommandReceipt,
  Empty,
  StreamControl,
  WireError,
} from '@keelwerk/core';
import type { ErrorMap, ErrorMapItem, ProcedureClient, Schema } from '@orpc/server';
import type { OrpcStreamItem } from './orpc-stream-item.ts';

/** The 16.4.2 wire form of a value: instants, dates, wide integers and bytes as strings, sets as arrays. */
type JsonOf<T> = T extends Temporal.Instant | Temporal.PlainDate | bigint | Uint8Array
  ? string
  : T extends ReadonlySet<infer I>
    ? readonly JsonOf<I>[]
    : T extends readonly (infer I)[]
      ? readonly JsonOf<I>[]
      : T extends object
        ? { readonly [K in keyof T]: JsonOf<T[K]> }
        : T;
type On<T, W> = W extends 'json' ? JsonOf<T> : T;
type Declared<C, D, W> = WireError & { readonly code: C; readonly details: On<D, W> };
type ErrorMapOf<Er, W> = {
  readonly [E in Er as E extends { readonly code: infer C extends string } ? C : never]: E extends {
    readonly code: infer C;
    readonly data: infer D;
  }
    ? ErrorMapItem<Schema<Declared<C, D, W>, Declared<C, D, W>>>
    : never;
};
type Call<I, O, E> = E extends ErrorMap
  ? ProcedureClient<Empty, Schema<I, I>, Schema<O, O>, E>
  : never;
type ProcedureOf<L, W> = L extends {
  readonly kind: 'query';
  readonly input: infer I;
  readonly output: infer O;
  readonly errors: infer Er;
}
  ? Call<On<I, W>, On<O, W>, ErrorMapOf<Er, W>>
  : L extends {
        readonly kind: 'command';
        readonly input: infer I;
        readonly output: infer O;
        readonly errors: infer Er;
        readonly execution: infer X;
      }
    ? Call<
        On<I, W>,
        X extends 'sync'
          ? On<O, W>
          : X extends 'async'
            ? CommandReceipt
            : On<O, W> | CommandReceipt,
        ErrorMapOf<Er, W>
      >
    : L extends {
          readonly kind: 'subscription';
          readonly input: infer I;
          readonly events: infer Ev;
          readonly errors: infer Er;
        }
      ? Call<
          On<I, W>,
          AsyncIteratorObject<OrpcStreamItem<On<Ev, W>> | StreamControl, void, void>,
          ErrorMapOf<Er, W>
        >
      : never;
type ModuleRecord<T, W> = (T extends { readonly actions: infer As }
  ? { readonly [A in keyof As]: ProcedureOf<As[A], W> }
  : Empty) &
  (T extends { readonly entities: infer Es }
    ? {
        readonly [E in keyof Es]: { readonly [A in keyof Es[E]]: ProcedureOf<Es[E][A], W> };
      }
    : Empty);

/** The typed oRPC client tree of an app (16.7.7): `createORPCClient<OrpcRouterOf<App>>(link)` from `@orpc/client`. */
export type OrpcRouterOf<App, Wire extends 'orpc' | 'json' = 'orpc'> = {
  readonly [M in keyof AppActionTree<App> & string as CamelCase<M>]: ModuleRecord<
    AppActionTree<App>[M],
    Wire
  >;
};
