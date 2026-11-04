import type { RuleMatch } from '../errors/rule-match.ts';
import { allOf } from './all-of.ts';
import { alwaysCondition } from './always-condition.ts';
import { anyOf } from './any-of.ts';
import { checkRuleCondition } from './check-rule-condition.ts';
import type { CompilePlanInput } from './compile-plan-input.ts';
import { isAlways } from './is-always.ts';
import { isNever } from './is-never.ts';
import { negate } from './negate.ts';
import { neverCondition } from './never-condition.ts';
import { operationOf } from './operation-of.ts';
import type { Plan } from './plan.ts';
import type { PlanClause } from './plan-clause.ts';
import { ruleConditions } from './rule-conditions.ts';
import { selectRules } from './select-rules.ts';

/**
 * Compiles the rules that cover an action into a plan for one principal (sections 8.2 and 8.4).
 * Default deny: without an allow rule the plan is `never`. Reads and transitions select the rows
 * some allow's `where` matches and no deny without `check` matches; creates test the new row with
 * `check ?? where`. A deny rule that lists fields hides or forbids those fields and never denies
 * the row. Rules are walked in id order, so one input compiles to one plan.
 */
export function compilePlan(input: CompilePlanInput): Plan {
  const { action, entity, context } = input;
  const operation = operationOf(action);
  const selected = selectRules(input.rules, action, context, input.transport ?? null, input.input);
  const allows: PlanClause[] = [];
  const denies: PlanClause[] = [];
  const fieldDenies: PlanClause[] = [];
  for (const rule of selected) {
    const conditions = ruleConditions(rule, context);
    checkRuleCondition(rule.id, entity, conditions.where);
    if (conditions.check !== null) checkRuleCondition(rule.id, entity, conditions.check);
    const clause: PlanClause =
      operation === 'create'
        ? {
            rule: rule.id,
            where: conditions.check ?? conditions.where,
            check: null,
            fields: rule.fields,
            reason: rule.reason,
          }
        : {
            rule: rule.id,
            where: conditions.where,
            check: operation === 'read' ? null : conditions.check,
            fields: rule.fields,
            reason: rule.reason,
          };
    if (rule.effect === 'allow') allows.push(clause);
    else if (rule.fields !== null && rule.fields.size > 0) fieldDenies.push(clause);
    else denies.push(clause);
  }

  const live = allows.filter((clause) => !isNever(clause.where));
  const rowDenies = operation === 'transition' ? denies.filter((c) => c.check === null) : denies;
  const where = allOf([
    anyOf(live.map((clause) => clause.where)),
    negate(anyOf(rowDenies.map((clause) => clause.where))),
  ]);
  const kind = isNever(where) ? 'never' : isAlways(where) ? 'always' : 'conditional';

  const unconditional = rowDenies.find((clause) => isAlways(clause.where));
  const rules: RuleMatch[] = [
    ...live.map((clause): RuleMatch => ({ id: clause.rule, effect: 'allow' })),
    ...denies.map((clause): RuleMatch => ({ id: clause.rule, effect: 'deny' })),
  ];
  const maskable = Object.entries(entity.fields)
    .filter(([, descriptor]) => descriptor.maskable)
    .map(([name]) => name);
  return {
    kind,
    operation,
    entity: entity.ref,
    action: action.ref,
    where: kind === 'never' ? neverCondition : kind === 'always' ? alwaysCondition : where,
    allows,
    denies,
    fieldDenies,
    maskable,
    rules,
    reason: kind === 'never' ? unconditional?.reason : undefined,
  };
}
