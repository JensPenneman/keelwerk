import type { Invocation } from './invocation.ts';
import type { RequestInfo } from './request-info.ts';

/** The transport facts of an invocation that rules and handlers may read: no headers beyond the user agent. */
export function requestInfoOf(invocation: Invocation<unknown>): RequestInfo {
  const { carrier } = invocation;
  const userAgent = carrier.headers?.['user-agent'];
  return {
    transport: carrier.transport,
    requestId: invocation.requestId,
    ...(carrier.connection === undefined ? {} : { connection: carrier.connection }),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}
