import { sameSubject } from './same-subject.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A rule set without `subjectId` (in any spelling or case) in the `principals` of its rules (14.7.5, step 5b): a rule whose
 * `principals` the erasure empties is dropped, never widened to the rest of its criteria. Answers the same
 * object when the id is nowhere in it, so a caller sees what changed by identity.
 */
export function scrubFlagTargeting(targeting: unknown, subjectId: string): unknown {
  if (!(isRecord(targeting) && Array.isArray(targeting.rules))) return targeting;
  const isNamed = (id: unknown): boolean => typeof id === 'string' && sameSubject(id, subjectId);
  let changed = false;
  const rules: unknown[] = [];
  for (const rule of targeting.rules as readonly unknown[]) {
    if (!(isRecord(rule) && Array.isArray(rule.principals) && rule.principals.some(isNamed))) {
      rules.push(rule);
      continue;
    }
    changed = true;
    const principals = rule.principals.filter((id: unknown) => !isNamed(id));
    if (principals.length > 0) rules.push({ ...rule, principals });
  }
  return changed ? { ...targeting, rules } : targeting;
}
