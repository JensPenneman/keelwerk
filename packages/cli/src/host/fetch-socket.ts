import { unixSocketFetch } from '@keelwerk/client/unix-socket';
import type { HostRequest } from '../context/cli-host.ts';

/** A request over a Unix socket, answered as a standard `Response`: the client's socket fetch (S-53) with the request of the host. */
export function fetchSocket(
  socketPath: string,
  path: string,
  init: HostRequest,
): Promise<Response> {
  return unixSocketFetch(socketPath)(`http://localhost${path}`, {
    method: init.method,
    headers: { ...init.headers },
    ...(init.body !== undefined && { body: init.body }),
    ...(init.signal !== undefined && { signal: init.signal }),
  });
}
