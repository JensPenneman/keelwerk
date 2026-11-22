import type { Scope } from '../storage/scope.ts';
import type { QuotaView } from './quota-view.ts';

/**
 * The queued cap a job carries (9.5.5): `queues.<q>.queued` of its queue in its scope, and undefined
 * without limits, in the deployment scope and for a job of the module `core`, which is never refused.
 */
export function queuedCapOf(
  limits: QuotaView | undefined,
  scope: Scope,
  queue: string,
  module: string,
): number | undefined {
  if (limits === undefined || scope.level === 'deployment' || module === 'core') return undefined;
  return limits.queueOf(scope, queue).queued;
}
