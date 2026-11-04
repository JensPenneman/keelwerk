import type { CommandReceipt } from '../../src/invoker/command-receipt.ts';
import type { ActionRef } from '../../src/model/action-ref.ts';
import type { AppActionTree } from '../../src/model/app-action-tree.ts';
import type { Empty } from '../../src/types/empty.ts';

type EntityLeaf<T, M, E, N> = M extends keyof T
  ? T[M] extends { readonly entities: infer Es }
    ? E extends keyof Es
      ? N extends keyof Es[E]
        ? Es[E][N]
        : never
      : never
    : never
  : never;
type ModuleLeaf<T, M, N> = M extends keyof T
  ? T[M] extends { readonly actions: infer As }
    ? N extends keyof As
      ? As[N]
      : never
    : never
  : never;
type LeafAt<P, R> = R extends `${infer M}.${infer E}.${infer N}`
  ? EntityLeaf<AppActionTree<P>, M, E, N>
  : R extends `${infer M}.${infer N}`
    ? ModuleLeaf<AppActionTree<P>, M, N>
    : never;
type InputAt<P, R> = LeafAt<P, R> extends { readonly input: infer I } ? I : never;
type EventAt<P, R> = LeafAt<P, R> extends { readonly events: infer E } ? E : never;
type InvokeResult<L, O> = L extends { readonly execution: infer X; readonly output: infer Out }
  ? X extends 'async'
    ? CommandReceipt
    : X extends 'either'
      ? O extends { readonly prefer: 'async' }
        ? CommandReceipt
        : Out
      : Out
  : never;

/** Options of one invocation. */
export interface InvokeOptions {
  readonly prefer?: 'sync' | 'async';
}

/** One frame of a subscription. */
export type Frame<Ev> =
  | { readonly control: 'reset' | 'head' | 'gap'; readonly state?: string }
  | { readonly event: Ev; readonly state: string };

/** Stand-in for @keelwerk/client: the typed client over an app's action tree (section 16.8.4). */
export interface AppClient<P> {
  as(scope: {
    readonly backend: string;
    readonly tenant: string;
    readonly token?: string;
  }): AppClient<P>;
  invoke<const R extends ActionRef<P>, const O extends InvokeOptions = Empty>(
    ref: R,
    input: InputAt<P, R>,
    options?: O,
  ): Promise<InvokeResult<LeafAt<P, R>, O>>;
  subscribe<const R extends ActionRef<P>>(
    ref: R,
    input: InputAt<P, R>,
  ): AsyncIterable<Frame<EventAt<P, R>>>;
}
