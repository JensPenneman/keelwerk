/** One configuration that is measured: which form runs, what it asks for, how it asks, and how many times. */
export interface BenchCell {
  readonly form: 'baseline' | 'plain' | 'generator';
  /** What each request of the decision asks for: a load by id, a new id, or a flag read. */
  readonly request: 'load' | 'newId' | 'flag';
  /** `ctx.all` puts the requests in one `yield*`; `unbatched` yields them one by one. */
  readonly batching: 'none' | 'unbatched' | 'all';
  /** The number of requests of the decision. */
  readonly count: number;
}
