import { cellOf } from './mark-cells.ts';
import type { MarkedField, MarkSite } from './mark-types.ts';
import { marksOfMember } from './marks-of-member.ts';

/** The name of the first member of `fields` that holds a mark whose cell at `site` is the code of another check, `code`. */
export function memberReferredTo(
  site: MarkSite,
  fields: Readonly<Record<string, MarkedField>> | undefined,
  code: string,
): string | undefined {
  return Object.entries(fields ?? {}).find(([name, field]) =>
    marksOfMember(field, name).some((found) => cellOf(site, found.kind, found.position) === code),
  )?.[0];
}
