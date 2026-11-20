/** What a unit has recorded of the queues it made takeable, and how far a savepoint may take it back. */
export interface ReadiedQueues {
  /** A job of `queue` became takeable. */
  ready(queue: string): void;
  /** Something became takeable in queues the unit cannot name (a group's slot, a provisioned group). */
  readyAnywhere(): void;
  mark(): number;
  /** Takes back what was recorded after `mark`, as a failed savepoint takes back its rows. */
  restore(mark: number): void;
  /** The queues, in no order and once each; `undefined` when something was recorded that names none. */
  queues(): readonly string[] | undefined;
}

/** An empty record for one unit; `undefined` entries stand for "anywhere". */
export function readiedQueues(): ReadiedQueues {
  const entries: (string | undefined)[] = [];
  return {
    ready: (queue) => {
      entries.push(queue);
    },
    readyAnywhere: () => {
      entries.push(undefined);
    },
    mark: () => entries.length,
    restore: (mark) => {
      entries.length = Math.min(entries.length, mark);
    },
    queues: () => {
      const queues = new Set<string>();
      for (const entry of entries) {
        if (entry === undefined) return undefined;
        queues.add(entry);
      }
      return [...queues];
    },
  };
}
