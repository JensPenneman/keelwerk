import { ClientError, createRetryPolicy, resumeFrames } from '@keelwerk/client';
import type { InvokeRequest } from '@keelwerk/core';
import type { UntypedClient } from '../untyped-client.ts';
import { CliFailure } from './cli-failure.ts';
import type { CliHost } from './cli-host.ts';
import type { DeploymentLink } from './deployment-link.ts';
import { isUnreachable } from './is-unreachable.ts';
import { retryUnreachable } from './retry-unreachable.ts';

/** The host still holds the slot of a connection that died: the refusal of the reopen is not final. */
function isRateLimited(failure: unknown): boolean {
  return (
    failure instanceof CliFailure &&
    typeof failure.outcome === 'object' &&
    failure.outcome.kind === 'rate_limited'
  );
}

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
        ...(options.onDeprecation !== undefined && { onDeprecation: options.onDeprecation }),
      };
      const target = await link();
      return await retryUnreachable(host, options.signal, () => target.invoke(request, settings));
    },
    subscribe(action, input, options = {}) {
      return resumeFrames(
        async (leg, signal) =>
          (await link()).subscribe(leg, {
            signal,
            ...(apiVersion !== undefined && { apiVersion }),
            ...(options.onDeprecation !== undefined && { onDeprecation: options.onDeprecation }),
          }),
        { action, ...(input !== undefined && { input }) },
        {
          ...(options.after !== undefined && { after: options.after }),
          ...(options.signal !== undefined && { signal: options.signal }),
          // Three tries in all before the first frame (16.9.5), as `retryUnreachable` makes.
          retry: createRetryPolicy({
            retries: 2,
            sleep: (milliseconds) => host.sleep(milliseconds),
          }),
          dropped: (failure) =>
            isUnreachable(failure) ||
            isRateLimited(failure) ||
            !(failure instanceof CliFailure || failure instanceof ClientError),
          failure: (error) => new CliFailure(error, error.message),
        },
      );
    },
  };
}
