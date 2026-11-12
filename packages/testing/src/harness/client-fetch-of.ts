import type { HostFetchOptions, TransportHost } from '@keelwerk/core';
import { clientAddresses } from './client-addresses.ts';

/**
 * The harness's dispatch through a host: a request whose `options.remoteAddress` is absent comes
 * from the next address of its own `clientAddresses()` source, so every request has its own client
 * address; a named one is passed as it is. The address is an argument of `host.fetch`, never a header.
 */
export function clientFetchOf(
  host: Pick<TransportHost, 'fetch'>,
): (request: Request, options?: HostFetchOptions) => Promise<Response> {
  const next = clientAddresses();
  return (request, options) =>
    host.fetch(
      request,
      options?.remoteAddress === undefined ? { ...options, remoteAddress: next() } : options,
    );
}
