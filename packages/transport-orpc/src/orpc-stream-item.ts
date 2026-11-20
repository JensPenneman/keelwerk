/**
 * One item of an oRPC subscription: `data` is the event exactly as it is, whatever it holds, and
 * `id` is the stream token to resume from (oRPC's `lastEventId`), absent when the source cannot
 * resume. A control frame (`head`, `reset`, `gap`) never has `data`, so a client tells the two
 * apart with `'data' in frame`.
 */
export interface OrpcStreamItem<E> {
  readonly data: E;
  readonly id?: string;
}
