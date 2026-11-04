/** A change of a lane's `enqueued` counter that the commit tail applies (section 9.5.2). */
export interface CommitTailLane {
  /** `kw_job_lanes.id` as decimal text. */
  readonly laneId: string;
  /** Jobs that became available (positive) or left the available state (negative). */
  readonly delta: number;
}
