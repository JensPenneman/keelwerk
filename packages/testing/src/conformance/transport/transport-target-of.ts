import { unixSocketFetch } from '@keelwerk/client/unix-socket';
import type { TransportCodec } from './transport-codec.ts';
import type { TransportRuntime } from './transport-runtime.ts';
import type { TransportTarget } from './transport-target.ts';

/** The target of one codec on a running deployment: its host dispatch, its tenants and its operator socket. */
export function transportTargetOf(
  runtime: TransportRuntime,
  codec: TransportCodec,
  cors: readonly string[],
  live = false,
): TransportTarget {
  return {
    name: codec.name,
    fetch: runtime.fetch,
    codec,
    tenants: Object.fromEntries(
      Object.entries(runtime.tenants).map(([name, id]) => [
        name,
        { id, domain: runtime.domains[name] ?? '' },
      ]),
    ),
    cors,
    backendConfig: runtime.backendConfig,
    operatorFetch: unixSocketFetch(runtime.socket),
    ...(live && { live }),
  };
}
