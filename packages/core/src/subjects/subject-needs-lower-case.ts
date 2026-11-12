import { erasableSubjectPattern } from '../encryption/erasable-subject-pattern.ts';
import { canonicalSubject } from './canonical-subject.ts';

/**
 * Whether a text is a 128-bit subject value written in upper or mixed case. Such a text is refused
 * only where an input or a draft is validated and, for a one-field data subject, in the fence; a
 * subject read through a stored path is folded to its canonical form, never refused. A text that
 * is no 128-bit value is not a subject id and is never refused here.
 */
export function subjectNeedsLowerCase(text: string): boolean {
  return canonicalSubject(text) !== text && !erasableSubjectPattern.test(text);
}
