import { errors } from '../errors/errors.ts';
import { canonicalSubject } from '../subjects/canonical-subject.ts';
import { subjectNeedsLowerCase } from '../subjects/subject-needs-lower-case.ts';
import type { EncryptPersonalValuesInput } from './encrypt-personal-values.ts';
import { erasableSubjectPattern } from './erasable-subject-pattern.ts';
import type { SealingContext } from './sealing-context.ts';
import { subjectIdOf } from './subject-id-of.ts';

/**
 * The fence of a data subject (14.7.4), run first for every event the write path seals. A row that
 * is created (or imported), or whose event changes the first segment of its data-subject path,
 * takes the subject's data key: the key is created at its first use and refused once the subject is
 * shredded, under the lock the shred takes, so a row created before the shred commits is seen by the
 * erasure's walk, which runs after the shred, and a row created after it is refused in every
 * process. The `erased` event is never fenced. A text that is not a 128-bit value is not a subject id
 * and is left alone. A 128-bit value in upper or mixed case is a validation error only for a
 * one-field data subject, where the event itself writes the text; a subject that comes from a
 * stored row (a path) is folded to its canonical form, because a stored value is never a reason to
 * refuse a write.
 */
export async function fenceDataSubject(
  context: SealingContext,
  input: EncryptPersonalValuesInput,
): Promise<void> {
  const path = input.entry.descriptor.dataSubject;
  if (path === null || input.name === 'erased') return;
  const [first = ''] = path.split('.');
  const creates = input.name === 'created' || input.name === 'imported';
  if (!creates && !(input.before !== null && Object.hasOwn(input.before, first))) return;
  const subject = await subjectIdOf(
    context,
    input.entry.descriptor,
    path,
    input.row,
    input.decided,
  );
  if (subject === undefined || !erasableSubjectPattern.test(canonicalSubject(subject))) return;
  if (path === first && subjectNeedsLowerCase(subject)) {
    throw errors.validation('a subject id is written in lower case', {
      issues: [{ path: [first], message: 'A subject id is written in lower case.' }],
    });
  }
  await context.dataKey(canonicalSubject(subject));
}
