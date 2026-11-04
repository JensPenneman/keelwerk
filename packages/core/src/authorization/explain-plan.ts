import { describeCondition } from './describe-condition.ts';
import type { Plan } from './plan.ts';
import type { PlanClause } from './plan-clause.ts';

function clauseLine(effect: string, clause: PlanClause): string {
  const check = clause.check === null ? '' : `, check ${describeCondition(clause.check)}`;
  const fields = clause.fields === null ? '' : `, fields ${[...clause.fields].sort().join(', ')}`;
  const reason = clause.reason === undefined ? '' : `, reason "${clause.reason}"`;
  return `  ${effect} ${clause.rule}: where ${describeCondition(clause.where)}${check}${fields}${reason}`;
}

/**
 * Renders a plan for support work (`ability.explain(plan)`, section 8.6): the resolved selection,
 * then each allow and deny rule with its condition, check, fields and reason.
 */
export function explainPlan(plan: Plan): string {
  const lines = [
    `${plan.action} on ${plan.entity}: ${plan.kind} (${plan.operation})`,
    `  selects ${describeCondition(plan.where)}`,
  ];
  if (plan.reason !== undefined) lines.push(`  denied: ${plan.reason}`);
  for (const clause of plan.allows) lines.push(clauseLine('allow', clause));
  for (const clause of plan.denies) lines.push(clauseLine('deny', clause));
  for (const clause of plan.fieldDenies) lines.push(clauseLine('deny fields', clause));
  if (plan.maskable.length > 0) lines.push(`  maskable: ${plan.maskable.join(', ')}`);
  return lines.join('\n');
}
