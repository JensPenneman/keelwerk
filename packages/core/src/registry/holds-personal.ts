import type { MarkedField } from '../fields/mark-types.ts';
import { marksOfMember } from '../fields/marks-of-member.ts';

/** Whether a field holds a personal mark, itself or as an element of a list or set; a `json` member is walked by the caller (`fields/marks-of-member.ts`). */
export function holdsPersonal(field: MarkedField): boolean {
  return marksOfMember(field).some(
    (mark) => mark.kind === 'personal' && mark.position !== 'nested',
  );
}
