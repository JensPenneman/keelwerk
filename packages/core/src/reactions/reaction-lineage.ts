/** Where a job or an event stands in a chain of asynchronous reactions (7.7); set and carried by the kernel only. */
export interface ReactionLineage {
  /** Reaction jobs between the chain's start and this job or event, at least 1; depth 0 is never stored. */
  readonly depth: number;
  /** The id of the event the chain started with: the event its first reaction job answered. */
  readonly origin: string;
}
