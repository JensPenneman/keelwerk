import { cellOf } from './mark-cells.ts';
import type { MarkedField, MarkSite } from './mark-types.ts';
import { marksOfMember } from './marks-of-member.ts';

/**
 * The personal mark of a member that `site` does not refuse (the kernel seals it, or a check of
 * its own refuses it): the member itself or a personal element of a list or set. `false` when the
 * member holds none there.
 */
export function personalFlagAt(
  site: MarkSite,
  field: MarkedField,
): false | { readonly subject: string | null } {
  const mark = marksOfMember(field).find(
    (found) => found.kind === 'personal' && cellOf(site, 'personal', found.position) !== false,
  );
  return mark === undefined ? false : { subject: mark.subject };
}
