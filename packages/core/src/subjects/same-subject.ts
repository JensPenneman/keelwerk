import { canonicalSubject } from './canonical-subject.ts';

/**
 * Whether two texts name one data subject: equal, or one 128-bit value in two spellings or cases.
 * A text that is no 128-bit value is compared as plain text.
 */
export function sameSubject(a: string | undefined, b: string): boolean {
  return a !== undefined && canonicalSubject(a) === canonicalSubject(b);
}
