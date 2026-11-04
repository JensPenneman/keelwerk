import type { LaneSettlement } from './postgres/settle-lanes-statement.ts';

/** The running load changes of lanes, summed per lane before they are written. */
export interface SqlLaneChanges {
  done(laneId: string, by: number): void;
  taken(laneId: string, by: number): void;
  readonly size: number;
  entries(): readonly LaneSettlement[];
}

/** An empty set of lane changes. */
export function sqlLaneChanges(): SqlLaneChanges {
  const lanes = new Map<string, { done: number; taken: number }>();
  const of = (laneId: string): { done: number; taken: number } => {
    const found = lanes.get(laneId) ?? { done: 0, taken: 0 };
    lanes.set(laneId, found);
    return found;
  };
  return {
    done: (laneId, by) => {
      of(laneId).done += by;
    },
    taken: (laneId, by) => {
      of(laneId).taken += by;
    },
    get size() {
      return lanes.size;
    },
    entries: () => [...lanes].map(([laneId, change]) => ({ laneId, ...change })),
  };
}
