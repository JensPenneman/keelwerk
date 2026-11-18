const maxRounds = 40;

/**
 * Dispatches and drains until two rounds in a row do nothing (40 rounds at most, then throws): the
 * wait a test takes before it reads what an asynchronous reaction or a job wrote.
 */
export async function settleReactions(
  dispatcher: { settled(): Promise<number> },
  drain: () => Promise<number>,
): Promise<void> {
  let quiet = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    const dispatched = await dispatcher.settled();
    const ran = await drain();
    quiet = dispatched === 0 && ran === 0 ? quiet + 1 : 0;
    if (quiet >= 2) return;
  }
  throw new Error(`the reactions did not settle in ${maxRounds} rounds`);
}
