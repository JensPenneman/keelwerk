import { unixSocketFetch } from '@keelwerk/client/unix-socket';
import type { TransportCodec } from './transport-codec.ts';
import type { TransportRuntime } from './transport-runtime.ts';
import type { TransportTarget } from './transport-target.ts';

/** The target of one codec on a running deployment: its host dispatch, its tenants and its operator socket; `advance` moves the pinned clock the runtime was started with. */
export function transportTargetOf(
  runtime: TransportRuntime,
  codec: TransportCodec,
  cors: readonly string[],
  live = false,
  advance?: (ms: number) => Promise<void>,
): TransportTarget {
  return {
    name: codec.name,
    fetch: runtime.fetch,
    codec,
    tenants: Object.fromEntries(
      Object.entries(runtime.tenants).map(([name, id]) => [
        name,
        {
          id,
          domain: runtime.domains[name] ?? '',
          ...(runtime.deprecatedPins[name] !== undefined && {
            deprecatedApiVersion: runtime.deprecatedPins[name],
          }),
        },
      ]),
    ),
    cors,
    revoke: runtime.revoke,
    bounds: runtime.bounds,
    headApiVersion: runtime.headApiVersion,
    backendConfig: runtime.backendConfig,
    operatorFetch: unixSocketFetch(runtime.socket),
    ...(runtime.connect !== undefined && { connect: runtime.connect }),
    ...(advance !== undefined && { advance }),
    ...(live && { live }),
  };
}
