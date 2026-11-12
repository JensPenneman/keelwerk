import type { LiveServerMessage } from '@keelwerk/core';
import type { TestSocket } from './test-socket.ts';

/**
 * The next live message that satisfies `test`. Only a notice (a deprecation, 15.4.7) is skipped; any
 * other frame that fails `test`, and a socket that closes or stays silent, is a failure that names
 * the frames seen so far.
 */
export async function liveMessageUntil(
  socket: TestSocket,
  test: (message: LiveServerMessage) => boolean,
): Promise<LiveServerMessage> {
  const seen: LiveServerMessage[] = [];
  for (;;) {
    let next: LiveServerMessage;
    try {
      next = JSON.parse(String(await socket.next())) as LiveServerMessage;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${reason} Frames seen: ${JSON.stringify(seen)}.`);
    }
    seen.push(next);
    if (next.type === 'notice') continue;
    if (test(next)) return next;
    throw new Error(`An unexpected frame arrived; frames seen: ${JSON.stringify(seen)}.`);
  }
}
