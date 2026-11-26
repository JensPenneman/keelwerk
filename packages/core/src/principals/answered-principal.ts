import type { Principal } from './principal.ts';

/**
 * What a fill answers as a principal: a principal of plain data. The two functions of a user and a
 * service, `subjectAs` and `idAs`, are not answered; the kernel builds them from the subject, the
 * subject reference and the id (they are pure functions of that data).
 */
export type AnsweredPrincipal<P extends Principal = Principal> = P extends Principal
  ? Omit<P, 'subjectAs' | 'idAs'>
  : never;
