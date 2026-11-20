import type { DeploymentFacts } from './deployment-facts.ts';
import type { DeploymentInput } from './deployment-input.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/**
 * Observers (G12): a reaction to every event costs one job per event and scope, so doctor lists each
 * one with the event types it never receives. One note per `on: 'all'` reaction of every composed
 * app, in reaction-id order.
 */
export async function checkObservers(
  input: DeploymentInput,
  _facts: DeploymentFacts,
  _now: Temporal.Instant,
): Promise<readonly DoctorFinding[]> {
  const observers = new Map<string, readonly string[]>();
  for (const registry of input.registries) {
    for (const reaction of registry.reactions.values()) {
      if (reaction.on === 'all') observers.set(reaction.id, [...(reaction.except ?? [])].sort());
    }
  }
  return [...observers]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, except]) =>
      findingOf(
        'observers',
        'note',
        id,
        `observes every event of a tenant or a backend: one job per event and scope, and receives the address and user agent of a data subject's requests; excepted: ${except.length === 0 ? 'none' : except.join(', ')}`,
        'nothing to do; an event type listed in except is never dispatched to it',
      ),
    );
}
