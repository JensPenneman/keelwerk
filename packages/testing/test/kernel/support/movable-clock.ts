/** A clock only the case moves, and the one call that moves it. */
export interface MovableClock {
  readonly clock: { readonly now: () => Temporal.Instant };
  /** Moves the clock `ms` forward. */
  readonly step: (ms: number) => void;
}

/** The clock all the processes of a case share, which the case moves. */
export function movableClock(start: string): MovableClock {
  let now = Temporal.Instant.from(start);
  return {
    clock: { now: () => now },
    step: (ms) => {
      now = now.add({ milliseconds: ms });
    },
  };
}
