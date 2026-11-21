import { errors, type SocketSession, type SurfaceAction } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';

/**
 * What a call must meet over the socket before it runs (section 16.7.5), in this order: only queries
 * and subscriptions run here (a command needs the headers of an HTTP request: its command id, its
 * preferences, its effects); an action with a cookie hint sets a cookie, which a socket answer cannot;
 * a call that starts after the mount began to close (`closing`) is refused `unavailable`, as HTTP
 * refuses it; and the session check of the host must hold, as an HTTP request opens a session of its
 * own. A call that does not meet them is refused and runs nothing.
 */
export async function admitSocketCall(
  socket: SocketSession,
  action: SurfaceAction,
  closing: AbortSignal | undefined,
): Promise<void> {
  if (action.kind === 'command') {
    throw coreError('core.unsupported', { message: 'Send commands over HTTP.' });
  }
  if (action.hints.http?.cookie !== undefined) {
    throw coreError('core.unsupported', {
      message: 'This action sets a cookie and is not available over a socket.',
    });
  }
  if (closing?.aborted === true) {
    throw errors.unavailable('The API is shutting down.', { retryAfter: 1 });
  }
  if (!(await socket.check())) {
    throw coreError('core.unavailable', { message: 'The session is no longer valid.' });
  }
}
