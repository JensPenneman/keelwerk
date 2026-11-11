/**
 * What `reactionDispatcher()` sets on the consumer builder it returns and on the spec it builds,
 * and the only thing `consumers()` accepts as the dispatcher. The symbol is not exported from the
 * package, so no other code can claim the `core.` consumer ids, and a consumer cannot be the
 * dispatcher by being named like it.
 */
export const dispatcherMark: unique symbol = Symbol('keelwerk.reactionDispatcher');
