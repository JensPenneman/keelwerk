import type { DeploymentCheck } from './deployment-check.ts';
import type { DeploymentFacts, FactValues } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';
import { unfedNote } from './unfed-note.ts';

/** The distinct texts in order, joined: a reason or a fix that several absent facts share is printed once. */
function distinctJoined(texts: readonly string[]): string {
  return [...new Set(texts)].join('; ');
}

/** The values of the named facts, or the reasons of those doctor does not have. */
function valuesOf(
  needs: readonly (keyof FactValues)[],
  facts: DeploymentFacts,
):
  | { readonly values: object }
  | { readonly reasons: readonly string[]; readonly fixes: readonly string[] } {
  const values: Record<string, unknown> = {};
  const reasons: string[] = [];
  const fixes: string[] = [];
  for (const name of needs) {
    const fact = facts[name];
    if (fact.known) values[name] = fact.value;
    else {
      reasons.push(fact.reason);
      fixes.push(fact.fix);
    }
  }
  return reasons.length > 0 ? { reasons, fixes } : { values };
}

/**
 * Runs the checks over the facts: the only caller of `judge`, `applies` and `concerns`. A check
 * doctor can judge whose needed fact is absent gives one 'not-checked' finding with the distinct
 * reasons and fixes and nothing else. A check no source feeds gives one note that doctor does not
 * check it, whether or not a fact it needs is absent: it never gives 'not-checked'. The rest are
 * judged on plain values.
 */
export function runDeploymentChecks(
  checks: readonly DeploymentCheck[],
  facts: DeploymentFacts,
): readonly DoctorFinding[] {
  return checks.flatMap((check): readonly DoctorFinding[] => {
    const needed = valuesOf(check.needs, facts);
    if (check.kind === 'unfed' && 'reasons' in needed) {
      return [unfedNote(check.group, check.name, check.reason)];
    }
    if ('reasons' in needed) {
      return [
        findingOf(
          check.group,
          'not-checked',
          check.name,
          distinctJoined(needed.reasons),
          distinctJoined(needed.fixes),
        ),
      ];
    }
    const values = needed.values as never;
    if (check.kind !== 'placement') {
      if (check.applies?.(values) === false) return [];
      return check.kind === 'unfed'
        ? [unfedNote(check.group, check.name, check.reason)]
        : check.judge(values);
    }
    return facts.placements.flatMap((placement): readonly DoctorFinding[] => {
      if (check.concerns?.(values, placement) === false) return [];
      if (!placement.capabilities.known) {
        return [
          findingOf(
            check.group,
            'not-checked',
            placement.name,
            `${check.name}: ${placement.capabilities.reason}`,
            placement.capabilities.fix,
          ),
        ];
      }
      return check.judge(values, { ...placement, capabilities: placement.capabilities.value });
    });
  });
}
