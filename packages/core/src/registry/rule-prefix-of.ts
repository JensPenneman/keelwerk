import type { AppliedPart } from './applied-part.ts';

/** The prefix of the ids of a part's rules: '<module>.<target>' for a contribution, '<module>' for a conditional part. */
export function rulePrefixOf(part: AppliedPart): string {
  return part.kind === 'contribution' ? `${part.declaredBy.id}.${part.target}` : part.declaredBy.id;
}
