import type { EraseOwnSubjectEffect } from '../protocol/erase-own-subject-effect.ts';

/**
 * `eraseOwnSubject(row)`: erases the id of one row of the module's own entity as a data subject, in
 * the unit that requests it (section 14.7.5). It is for a row whose id is a subject nothing else
 * holds, such as an invitation that has ended; the kernel refuses it when anything else holds the
 * subject.
 */
export function eraseOwnSubject(row: {
  readonly type: string;
  readonly id: string;
}): EraseOwnSubjectEffect {
  return Object.freeze({
    kind: 'eraseOwnSubject',
    type: 'eraseOwnSubject',
    row: Object.freeze({ type: row.type, id: row.id }),
  });
}
