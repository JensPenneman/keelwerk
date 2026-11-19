import type { Caller } from './call.ts';
import { lendCall } from './lend-call.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/** Lends each title as `caller`, one after the other; a refused lend throws with its error, so a case never waits for an item that cannot come. */
export async function lendTitles(
  target: TransportTarget,
  subject: string,
  caller: Caller,
  titles: readonly string[],
): Promise<void> {
  for (const title of titles) {
    const sent = await sendCall(target, lendCall(subject, title, { caller }));
    if (!sent.decoded.ok) {
      throw new Error(
        `Lending "${title}" as ${subject} was refused: ${JSON.stringify(sent.decoded)}`,
      );
    }
  }
}
