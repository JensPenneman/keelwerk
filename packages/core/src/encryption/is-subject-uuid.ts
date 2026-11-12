import { subjectUuidPattern } from './subject-uuid-pattern.ts';

/** Whether text is a lower-case UUID: a data subject is a row id, and the subject columns of the key tables hold one. */
export function isSubjectUuid(text: string): boolean {
  return subjectUuidPattern.test(text);
}
