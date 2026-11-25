/**
 * The responses `serveSseStream` made: they end themselves at the maximum duration, at stop and when the
 * session no longer holds, so the stream gate of a mounted route
 * (`withStreamSlot`) only holds their slot.
 */
export const servedByHost: WeakSet<Response> = new WeakSet();
