import type { SealingContext } from './sealing-context.ts';

/** Records that a subject's personal values sit in a stream (`kw_subject_refs`, 14.7.4); erasure walks these. */
export function addSubjectRef(
  context: SealingContext,
  subjectId: string,
  type: string,
  streamId: string,
): Promise<void> {
  return context.unit.keys.addRefs(subjectId, [{ type, id: streamId }]);
}
