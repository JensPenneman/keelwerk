import { cellOf } from './mark-cells.ts';
import type { MarkedField, MarkSite } from './mark-types.ts';
import { marksOfMember } from './marks-of-member.ts';

/** Whether a member holds any mark `site` does not refuse: its value must stay out of every copy the kernel shows. */
export function hidesMemberAt(site: MarkSite, field: MarkedField): boolean {
  return marksOfMember(field).some((found) => cellOf(site, found.kind, found.position) !== false);
}
