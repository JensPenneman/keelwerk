import { compilePlan } from '../authorization/compile-plan.ts';
import { describeCondition } from '../authorization/describe-condition.ts';
import { evaluateGate } from '../authorization/evaluate-gate.ts';
import { explainPlan } from '../authorization/explain-plan.ts';
import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { RuleMatch } from '../errors/rule-match.ts';
import type { DecisionExplanation, ExplainedRule } from './decision-explanation.ts';
import type { ExplainDecisionInput } from './explain-decision-input.ts';
import { ruleFile } from './rule-file.ts';

function principalId(context: PrincipalContext): string | undefined {
  const { principal } = context;
  switch (principal.kind) {
    case 'user':
      return String(principal.subject);
    case 'service':
    case 'operator':
      return String(principal.id);
    default:
      return undefined;
  }
}

function scopeText(context: PrincipalContext): string {
  const { scope } = context;
  if (scope.level === 'deployment') return 'deployment';
  return scope.level === 'backend'
    ? `backend ${scope.backendId}`
    : `tenant ${scope.tenantId} of backend ${scope.backendId}`;
}

/**
 * The authorization decision without executing (section 8.6): the gate's verdict with the rules
 * that matched, each with its module and file, and, for an entity action, the plan the principal
 * has and the masks it implies (which rules reveal or hide each maskable field).
 */
export function explainDecision(input: ExplainDecisionInput): DecisionExplanation {
  const { action, context, rules } = input;
  const transport = input.transport ?? null;
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const named = (match: RuleMatch): ExplainedRule => {
    const rule = byId.get(match.id);
    const module = rule?.module ?? match.id.split('.')[0] ?? '';
    return {
      id: match.id,
      effect: match.effect,
      module,
      file: ruleFile(match.id, module),
      ...(rule?.reason === undefined ? {} : { reason: rule.reason }),
    };
  };
  const gate = evaluateGate({ rules, action, context, transport, input: input.input });
  const entity =
    action.entity === undefined ? undefined : input.registry.entities.get(action.entity);
  const plan =
    entity === undefined
      ? undefined
      : compilePlan({
          rules,
          action,
          entity: entity.descriptor,
          context,
          transport,
          input: input.input,
        });
  const id = principalId(context);
  return {
    action: action.ref,
    kind: action.kind,
    principal: { kind: context.principal.kind, ...(id === undefined ? {} : { id }) },
    scope: scopeText(context),
    allowed: gate.allowed && plan?.kind !== 'never',
    ...(gate.reason === undefined
      ? plan?.reason === undefined
        ? {}
        : { reason: plan.reason }
      : { reason: gate.reason }),
    rules: gate.rules.map(named),
    ...(plan === undefined
      ? {}
      : {
          plan: {
            kind: plan.kind,
            operation: plan.operation,
            entity: plan.entity,
            selects: describeCondition(plan.where),
            text: explainPlan(plan),
            masks: plan.maskable.map((field) => ({
              field,
              revealedBy: plan.allows
                .filter((clause) => clause.fields === null || clause.fields.has(field))
                .map((clause) => clause.rule),
              hiddenBy: plan.fieldDenies
                .filter((clause) => clause.fields?.has(field) === true)
                .map((clause) => clause.rule),
            })),
          },
        }),
  };
}
