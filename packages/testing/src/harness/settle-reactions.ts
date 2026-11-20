const maxRounds = 40;

/**
 * Dispatches and drains until a round does nothing (40 rounds at most, then throws): the wait a test
 * takes before it reads what an asynchronous reaction or a job wrote. A drain sweeps every
 * queue of every namespace after everything committed before it and takes every job then due that a
 * free slot, its lane and its group admit (a take that promoted jobs takes again); a job made takeable
 * while it runs is run by it only if its wake-up arrives first, else by the next round, which every
 * round that ran a job gets. So a round with no dispatch and no job is rest.
 */
export async function settleReactions(
  dispatcher: { settled(): Promise<number> },
  drain: () => Promise<number>,
): Promise<void> {
  for (let round = 0; round < maxRounds; round += 1) {
    const dispatched = await dispatcher.settled();
    const ran = await drain();
    if (dispatched === 0 && ran === 0) return;
  }
  throw new Error(`the reactions did not settle in ${maxRounds} rounds`);
}
