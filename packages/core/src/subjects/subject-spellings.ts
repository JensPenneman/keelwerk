import { erasableSubjectPattern } from '../encryption/erasable-subject-pattern.ts';
import { canonicalSubject } from './canonical-subject.ts';

/**
 * Every text a data subject may be stored as: the canonical hyphenated UUID, the 32 lower-case hex
 * digits, and the two upper-case forms of those. A subject is 128 opaque bits; the key tables hold
 * it in uuid columns, which read all of them as one value, while the rows, receipts and flag rules
 * that name it keep the text the writer chose (a value stored earlier in upper case is never
 * rewritten). A lookup in a text column asks for each of these. A text that is no 128-bit value is
 * answered alone.
 */
export function subjectSpellings(subjectId: string): readonly string[] {
  const canonical = canonicalSubject(subjectId);
  if (!erasableSubjectPattern.test(canonical)) return [subjectId];
  const compact = canonical.replaceAll('-', '');
  return [canonical, compact, canonical.toUpperCase(), compact.toUpperCase()];
}
