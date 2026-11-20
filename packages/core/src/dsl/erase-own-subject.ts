import type { EraseOwnSubjectEffect } from '../protocol/erase-own-subject-effect.ts';

/**
 * `eraseOwnSubject(row)`: erases the id of one row of the module's own entity as a data subject, in
 * the unit that requests it (section 14.7.5). It is for a row whose id is a subject nothing else
 * holds, such as an invitation that has ended. The unit commits whether or not the erasure may
 * start: when a rule holds erasures, or anything else holds the subject, the kernel's job waits and
 * tries again until nothing does.
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
