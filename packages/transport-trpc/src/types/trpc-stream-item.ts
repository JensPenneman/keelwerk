/**
 * An item of a subscription as the contract frames it (section 16.7.5): the event exactly as it is
 * under `data`, and, for an item of a resumable action that carries a state, the stream token to
 * resume after under `id`. Nothing else sits at its top level, so an event of any shape, even one
 * with a member named `control`, is never taken for a control frame. An event with no value (the
 * `void` output of an empty shape) is `undefined` under `transformer: 'superjson'` and `null` under
 * `transformer: 'json'`, whose wire cannot carry `undefined` and would drop `data`.
 */
export type TrpcStreamItem<O> = { readonly data: O; readonly id?: string };
