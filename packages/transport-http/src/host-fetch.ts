import type { HostFetchOptions } from '@keelwerk/core';
import type { Dispatcher } from './dispatcher.ts';
import { normalizeAddress } from './normalize-address.ts';

/**
 * `host.fetch(request, options?)`: dispatches through the host's own routing, without a port
 * (sections 16.8.5 and S-52). The client address is `options.remoteAddress`, else the loopback;
 * a request header never sets it, so no client can choose its own address. The address is put in
 * the form a socket peer has (an IPv4-mapped one as IPv4, IPv6 lower case and compressed), and a
 * zone suffix (`%eth0`) is refused, so one client is one stored address.
 */
export function hostFetch(
  dispatcher: Dispatcher,
): (request: Request, options?: HostFetchOptions) => Promise<Response> {
  return (request, options) => {
    const given = options?.remoteAddress;
    const remoteAddress = given === undefined ? undefined : normalizeAddress(given);
    if (given !== undefined && remoteAddress === undefined) {
      return Promise.reject(
        new TypeError(`host.fetch: remoteAddress '${given}' is not an IP address without a zone.`),
      );
    }
    return dispatcher.handle(request, remoteAddress === undefined ? {} : { remoteAddress });
  };
}
