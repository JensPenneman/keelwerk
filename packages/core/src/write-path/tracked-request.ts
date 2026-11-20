import type { DecisionRequest } from '../events/decision-request.ts';
import type { RequestInfo } from '../invoker/request-info.ts';

export interface TrackedRequest {
  /** Handed to the read context as `ctx.request`: getters over the given request. */
  readonly request: RequestInfo;
  /** The members that were read: `transport`, `userAgent ?? null`, `connection: true` when the request carried one (the fact, not the address); undefined when none was (reading only `requestId` records nothing). */
  read(): DecisionRequest | undefined;
}

/**
 * Wraps the request a handler sees as `ctx.request`: what a decision record keeps is the transport,
 * the user agent and the fact that a connection the request carried was read, each on its own
 * (S-126). The kernel's own copy of the request stays untouched.
 */
export function trackedRequest(request: RequestInfo): TrackedRequest {
  let transportRead = false;
  let userAgentRead = false;
  let connectionRead = false;
  // A member the request does not carry stays hidden from enumeration, so a copy of the context's
  // request looks like the request itself; reading it still counts.
  const tracked = {} as { -readonly [K in keyof RequestInfo]: RequestInfo[K] };
  Object.defineProperties(tracked, {
    transport: {
      enumerable: true,
      get: () => {
        transportRead = true;
        return request.transport;
      },
    },
    userAgent: {
      enumerable: request.userAgent !== undefined,
      get: () => {
        userAgentRead = true;
        return request.userAgent;
      },
    },
    connection: {
      enumerable: request.connection !== undefined,
      get: () => {
        connectionRead = true;
        return request.connection;
      },
    },
    requestId: { enumerable: true, get: () => request.requestId },
  });
  return {
    request: tracked,
    read: () => {
      const read: DecisionRequest = {
        ...(transportRead ? { transport: request.transport } : {}),
        ...(userAgentRead ? { userAgent: request.userAgent ?? null } : {}),
        ...(connectionRead && request.connection !== undefined ? { connection: true } : {}),
      };
      return Object.keys(read).length === 0 ? undefined : read;
    },
  };
}
