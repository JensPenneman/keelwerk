/**
 * The wait of every case that moves the clock in steps of `steppedClockStepMs` until a socket is seen
 * closed: `vi.waitFor` makes a step every `interval` ms for at most `timeout` ms. The longest loop of
 * steps any case makes follows from it (`expectSteppedClockBounds` reads it), so a longer wait here
 * is seen by the guard of the runners' bounds and the constant of `steppedClockLiveSocket`.
 */
export const steppedClockWait = { timeout: 10_000, interval: 100 } as const;
