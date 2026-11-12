import type { FlagRule } from '../flags/flag-targeting.ts';
import { sameSubject } from './same-subject.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasCriterion(rule: Record<string, unknown>): boolean {
  const { tenants, principals, when } = rule;
  return (
    (Array.isArray(tenants) && tenants.length > 0) ||
    (Array.isArray(principals) && principals.length > 0) ||
    (when !== undefined && when !== null)
  );
}

/**
 * A rule set without `subjectId` (in any spelling or case) in the `principals` of its rules (14.7.5, step 5b): a rule left
 * with no criterion is dropped, as a rule that names none is not a valid rule. Answers the same
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
    const { principals: _removed, ...rest } = rule as Record<string, unknown> & FlagRule;
    const kept = principals.length === 0 ? rest : { ...rest, principals };
    if (hasCriterion(kept)) rules.push(kept);
  }
  return changed ? { ...targeting, rules } : targeting;
}
