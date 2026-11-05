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
  // The masks of a command that returns an entity are those of the read plan that shapes its output.
  const output = action.kind === 'command' ? action.entityOutput : undefined;
  const readAction =
    output === undefined
      ? undefined
      : input.registry.actions.get(`${output.entity}.${output.shape === 'row' ? 'get' : 'query'}`);
  const readEntity = output === undefined ? undefined : input.registry.entities.get(output.entity);
  const maskPlan =
    readAction === undefined || readEntity === undefined
      ? plan
      : compilePlan({
          rules,
          action: readAction,
          entity: readEntity.descriptor,
          context,
          transport,
        });
  const id = principalId(context);
  const notes =
    action.kind === 'command' && action.entityOutput?.shape === 'row'
      ? [
          `The row this command returns is shaped under the caller's read plan of ${action.entityOutput.entity}; when it lies outside that plan the answer is the reference { entity, id, version } (section 8.4).`,
        ]
      : [];
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
    ...(notes.length === 0 ? {} : { notes }),
    ...(plan === undefined
      ? {}
      : {
          plan: {
            kind: plan.kind,
            operation: plan.operation,
            entity: plan.entity,
            selects: describeCondition(plan.where),
            text: explainPlan(plan),
            masks: (maskPlan ?? plan).maskable.map((field) => ({
              field,
              revealedBy: (maskPlan ?? plan).allows
                .filter((clause) => clause.fields === null || clause.fields.has(field))
                .map((clause) => clause.rule),
              hiddenBy: (maskPlan ?? plan).fieldDenies
                .filter((clause) => clause.fields?.has(field) === true)
                .map((clause) => clause.rule),
            })),
          },
        }),
  };
}
