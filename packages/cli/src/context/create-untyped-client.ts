import type { InvokeRequest } from '@keelwerk/core';
import type { UntypedClient } from '../untyped-client.ts';
import type { CliHost } from './cli-host.ts';
import type { DeploymentLink } from './deployment-link.ts';
import { retryUnreachable } from './retry-unreachable.ts';

/** An `UntypedClient` over a link. Command ids are minted once per call and reused by network retries. */
export function createUntypedClient(
  link: () => Promise<DeploymentLink>,
  host: CliHost,
  apiVersion?: string,
): UntypedClient {
  return {
    async invoke(action, input, options = {}) {
      const request: InvokeRequest = {
        action,
        ...(input !== undefined && { input }),
        commandId: options.commandId ?? host.newId(),
        ...(options.prefer !== undefined && { prefer: options.prefer }),
      };
      const settings = {
        ...(options.signal !== undefined && { signal: options.signal }),
        ...(options.traceparent !== undefined && { traceparent: options.traceparent }),
        ...(apiVersion !== undefined && { apiVersion }),
      };
      const target = await link();
      return await retryUnreachable(host, options.signal, () => target.invoke(request, settings));
    },
  };
}
