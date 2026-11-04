/**
 * What a pure handler returns: a value, a request or a generator, never a promise or an async
 * generator. A thenable has a callable `then` and an async generator an `asyncIterator`; both are
 * refused, so `async` handlers do not type-check (section 7.9.2).
 */
type PureResult =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | (object & { readonly then?: never; readonly [Symbol.asyncIterator]?: never });

/**
 * A command's `decide`, a query's `read`, a subscription's `source`, a reaction's `react` or a
 * service: any pure function or generator function. The parameters are erased (method form, so typed handlers assign and calls need no cast) because the
 * registry stores handlers of every module and calls them only through the interpreter.
 */
export type ActionHandler = { call(...args: readonly unknown[]): PureResult }['call'];
