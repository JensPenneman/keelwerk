import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { Membership } from '../../principals/membership.ts';
import { readList } from '../../principals/read-list.ts';

/**
 * A membership's kind starts with the id of the module whose fill returned it, followed by a dot
 * (section 8.5), for a principal resolver as for an enricher: a module's authorization helpers trust
 * their own kinds. Another kind is refused as `internal`; the message names the kind, never its id or
 * role. The list is read once and the copy that was checked is the one returned, so nothing that
 * answers differently on a second read can land a kind that was not checked.
 */
export function keepOwnMemberships(
  point: 'core.principalResolvers' | 'core.principalEnrichers',
  module: string,
  memberships: readonly Membership[],
): Membership[] {
  const kept = readList(memberships, 'memberships').map((member) => {
    const { kind, id, role } = member as Membership;
    return { kind, id, role };
  });
  for (const [index, { kind, id, role }] of kept.entries()) {
    if (typeof kind !== 'string' || typeof id !== 'string' || typeof role !== 'string') {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `A fill of ${point} by "${module}" returned memberships[${index}] with a member that is not text.`,
      });
    }
    if (kind.startsWith(`${module}.`)) continue;
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: `A fill of ${point} by "${module}" returned a membership of kind "${kind}", which is not a kind of "${module}".`,
    });
  }
  return kept;
}
