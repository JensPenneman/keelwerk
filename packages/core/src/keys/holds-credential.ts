import type { MarkedField } from '../fields/mark-types.ts';
import { marksOfMember } from '../fields/marks-of-member.ts';

/** Whether `field` is a credential field (`field.secret()`, `field.verifier()`) or holds one as an element of a list or set; a `json` member is walked by the caller (`fields/marks-of-member.ts`). */
export function holdsCredential(field: MarkedField): boolean {
  return marksOfMember(field).some(
    (mark) => mark.kind !== 'personal' && mark.position !== 'nested',
  );
}
