import type { InvocationSession } from '@keelwerk/core';
import type { HostContext } from './host-context.ts';

/**
 * One slot for a stream or a socket of the session: first the host's own bounds per process
 * (`host.limits.take`, 15.4.10), then the deployment-wide `core.liveConnections` (`holdConnection`).
 * Each refusal keeps its own code; a refusal of the second gives the first back, so a stream the
 * process refuses holds nothing across the deployment. Answers the release of both, once.
 */
export async function takeStreamSlot(
  host: HostContext,
  session: InvocationSession,
  address: string,
): Promise<() => void> {
  const own = host.limits.take(session, address);
  if (host.deps.holdConnection === undefined) return own;
  try {
    const shared = await host.deps.holdConnection(session);
    return () => {
      own();
      shared();
    };
  } catch (failure) {
    own();
    throw failure;
  }
}
