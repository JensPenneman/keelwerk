/** The slots of one queue's fetcher in this process (21.1): how many attempts it may run at once. */
export interface WorkerSlots {
  readonly total: number;
  /** Slots not running an attempt. */
  free(): number;
  /** Takes `count` slots for attempts about to start; `RangeError` beyond the free ones. */
  hold(count: number): void;
  /** Gives one slot back when its attempt settled. */
  release(): void;
}

/** Slot accounting for `total` slots; `busy` and `total` stay in memory in M2-1 (D9). */
export function workerSlots(total: number): WorkerSlots {
  let busy = 0;
  return {
    total,
    free: () => total - busy,
    hold: (count) => {
      if (count < 0 || count > total - busy) {
        throw new RangeError(`Cannot hold ${count} slots with ${total - busy} free.`);
      }
      busy += count;
    },
    release: () => {
      if (busy === 0) throw new RangeError('No slot is held.');
      busy -= 1;
    },
  };
}
