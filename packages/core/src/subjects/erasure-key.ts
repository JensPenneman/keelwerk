import { canonicalSubject } from './canonical-subject.ts';

/**
 * The identity of one erasure: its tenant, its command id and its subject in canonical form
 * (a command id is unique in one scope only, and the subject has several spellings). Everything
 * that tells erasures apart, a replay key, a set of finished erasures, a derived command id, is
 * built from this text.
 */
export function erasureKey(erasure: {
  readonly tenantId: string;
  readonly commandId: string;
  readonly subjectId: string;
}): string {
  return JSON.stringify([erasure.tenantId, erasure.commandId, canonicalSubject(erasure.subjectId)]);
}
