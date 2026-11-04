/** A job a take moved to `running`, with the fencing pair (worker, attempt) its completion needs. */
export interface TakenJob {
  readonly id: string;
  readonly laneId: string;
  readonly scopeId: string;
  readonly cost: number;
  readonly attempt: number;
}
