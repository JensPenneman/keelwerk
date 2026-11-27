import { cellOf } from './mark-cells.ts';
import type { MarkedField, MarkSite } from './mark-types.ts';
import { marksOfMember } from './marks-of-member.ts';

/** The name of the first member of `fields` that holds a credential at a position `site` does not seal (a refusal), if any. */
export function unsealedCredentialMember(
  site: MarkSite,
  fields: Readonly<Record<string, MarkedField>>,
): string | undefined {
  return Object.entries(fields).find(([name, field]) =>
    marksOfMember(field, name).some(
      (found) => found.kind !== 'personal' && cellOf(site, found.kind, found.position) !== true,
    ),
  )?.[0];
}
