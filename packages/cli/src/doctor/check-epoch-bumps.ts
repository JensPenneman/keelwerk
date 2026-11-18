import type { DeploymentFacts } from './deployment-facts.ts';
import type { DeploymentInput } from './deployment-input.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/**
 * Epoch bumps (section 14.7.6): a scope whose mark holds an epoch above 0 was moved there by a
 * restore the runtime detected at `connect`, so the tokens issued before it answer reset. A bump
 * that has happened needs no action, and the mark's `updatedAt` is rewritten every minute so it
 * dates nothing: one note per namespace (in id order) counts the scopes and names the highest
 * epoch; the warning at connect, one per scope with its reason, is the alert. A reader that cannot
 * list the marks, or a deployment with none above 0, gives nothing.
 */
export async function checkEpochBumps(
  input: DeploymentInput,
  _facts: DeploymentFacts,
  _now: Temporal.Instant,
): Promise<readonly DoctorFinding[]> {
  const marks = (await input.reader?.bumpedMarks?.()) ?? [];
  const namespaces = new Map<string, { scopes: number; highest: number }>();
  for (const mark of marks) {
    const known = namespaces.get(mark.namespaceId) ?? { scopes: 0, highest: 0 };
    namespaces.set(mark.namespaceId, {
      scopes: known.scopes + 1,
      highest: Math.max(known.highest, mark.epoch),
    });
  }
  return [...namespaces]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([namespaceId, { scopes, highest }]) =>
      findingOf(
        'epoch-bumps',
        'note',
        namespaceId,
        `${scopes} scopes of namespace ${namespaceId} moved to a new epoch after a detected restore (highest epoch ${highest}); tokens issued before each restore answer reset`,
        'nothing to do when the restore was intended; each bump is logged at warn at connect with its scope and reason',
      ),
    );
}
