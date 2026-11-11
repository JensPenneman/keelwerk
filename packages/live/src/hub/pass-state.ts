/** What a reader keeps of its passes: the one in flight, which closing aborts, and the units that have not settled. */
export interface PassState {
  current: AbortController | undefined;
  readonly units: Set<Promise<void>>;
}
