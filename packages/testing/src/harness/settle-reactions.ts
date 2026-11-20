const maxRounds = 40;

/**
 * Dispatches and drains until a round does nothing (40 rounds at most, then throws): the wait a test
 * takes before it reads what an asynchronous reaction or a job wrote. Each round's drain gives the
 * guarantee of `TestRuntime.drainJobs`; a job made takeable while a drain runs is run by the next
 * round, which every round that ran a job gets. So a round with no dispatch and no job is rest.
 * Under vitest's default fake timers this does not settle wherever the reaction dispatcher finds
 * work: it takes its turns with `setImmediate`, so keep that real around it.
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
