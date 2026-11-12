import type { LiveServerMessage } from '@keelwerk/core';
import type { LiveSocketState } from './live-socket-state.ts';

/** Sends one message of the host on the socket; a socket that is gone or stalled drops it, so no caller waits on a dead peer. */
export async function sendLiveMessage(
  state: LiveSocketState,
  message: LiveServerMessage,
): Promise<void> {
  try {
    await state.open.connection.send(JSON.stringify(message));
  } catch {
    // The socket is closing: nothing is left to tell.
  }
}
