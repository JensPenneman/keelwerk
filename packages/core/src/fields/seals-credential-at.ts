import { cellOf } from './mark-cells.ts';
import type { MarkedField, MarkKind, MarkSite } from './mark-types.ts';
import { marksOfMember } from './marks-of-member.ts';

/** Whether a member holds a secret or verifier that the kernel seals at `site` (each element of a list of secrets included). */
export function sealsCredentialAt(site: MarkSite, field: MarkedField, kind?: MarkKind): boolean {
  return marksOfMember(field).some(
    (found) =>
      found.kind !== 'personal' &&
      (kind === undefined || found.kind === kind) &&
      cellOf(site, found.kind, found.position) === true,
  );
}
