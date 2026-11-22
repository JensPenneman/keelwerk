/** The cap and weight a unit gave one existing lane, written to its row at the end of the unit. */
export interface SqlLaneLimit {
  readonly laneId: string;
  readonly cap: number;
  readonly weight: number;
}
