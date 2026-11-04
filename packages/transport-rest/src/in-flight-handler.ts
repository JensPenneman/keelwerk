import { errors, type HttpHandler, type MountHandle } from '@keelwerk/core';
import { problemResponse } from './problem-details.ts';

/** A handler that counts its requests, and the handle that waits for them. */
export interface InFlightHandler {
  readonly handler: HttpHandler;
  readonly handle: MountHandle;
}

/**
 * Wraps a handler for shutdown (section 16.3.2): after `close` starts, new requests are answered
 * `unavailable`, and `close` resolves when the requests in flight are done or the deadline aborts.
 */
export function inFlightHandler(inner: HttpHandler, mountPath: string): InFlightHandler {
  const running = new Set<Promise<unknown>>();
  let closing = false;
  return {
    handler: async (request, ctx) => {
      if (closing) {
        return problemResponse(errors.unavailable('The API is shutting down.', { retryAfter: 1 }), {
          request,
          mountPath,
          requestId: ctx.requestId,
          audience: 'public',
        });
      }
      const pending = inner(request, ctx);
      running.add(pending);
      try {
        return await pending;
      } finally {
        running.delete(pending);
      }
    },
    handle: {
      async close(deadline) {
        closing = true;
        const settled = Promise.allSettled([...running]);
        const aborted = new Promise<void>((resolve) => {
          if (deadline.aborted) {
            resolve();
          }
          deadline.addEventListener('abort', () => resolve(), { once: true });
        });
        await Promise.race([settled, aborted]);
      },
    },
  };
}
