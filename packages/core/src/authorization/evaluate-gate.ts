import type { RuleMatch } from '../errors/rule-match.ts';
import type { GateInput } from './gate-input.ts';
import type { GateResult } from './gate-result.ts';
import { isAlways } from './is-always.ts';
import { isNever } from './is-never.ts';
import { itemAction } from './item-action.ts';
import { operationOf } from './operation-of.ts';
import { ownModuleRulePrefix } from './own-module-rule-prefix.ts';
import { ruleApplies } from './rule-applies.ts';
import { ruleConditions } from './rule-conditions.ts';
import { selectRules } from './select-rules.ts';

const scopeLevels = {
  tenant: ['tenant'],
  backend: ['backend', 'tenant'],
  deployment: ['deployment'],
  invocation: ['tenant', 'backend', 'deployment'],
} as const;

function refusal(reason: string): GateResult {
  return { allowed: false, rules: [], reason };
}

/** A batch `set` passes the gate when some operation it batches does; each item is authorized later against its own. */
function gateBatch(input: GateInput, evaluate: (input: GateInput) => GateResult): GateResult {
  const results = (['create', 'update', 'archive', 'restore'] as const).map((operation) =>
    evaluate({ ...input, action: itemAction(input.action, operation) }),
  );
  const allowed = results.find((result) => result.allowed);
  if (allowed !== undefined) return allowed;
  const rules = new Map<string, RuleMatch>();
  for (const result of results) for (const match of result.rules) rules.set(match.id, match);
  return {
    allowed: false,
    rules: [...rules.values()],
    reason: results.find((result) => result.reason !== undefined)?.reason,
  };
}

/**
 * The gate (section 8.4): may this principal perform this action here at all? Checks, in order,
 * the principal kinds the action admits, the scope level (a deployment-scope action is reachable
 * by operator principals only, a backend-scope action from the backend or one of its tenants, and a
 * principal resolved in one tenant does not act in another), then the rules. A public action needs
 * no rule. Module-level actions need an allow whose `when` holds and no deny whose `when` holds;
 * entity actions need an allow that is not `never` and no deny that covers every row.
 */
export function evaluateGate(input: GateInput): GateResult {
  if (input.action.generated === 'set') return gateBatch(input, evaluateGate);
  const { action, context, rules } = input;
  const { principal, scope } = context;
  const transport = input.transport ?? null;

  if (action.principal !== undefined && !action.principal.includes(principal.kind)) {
    return refusal(`"${action.ref}" does not admit ${principal.kind} principals.`);
  }
  if (!(scopeLevels[action.scope] as readonly string[]).includes(scope.level)) {
    return refusal(`"${action.ref}" runs at the ${action.scope} level, not at ${scope.level}.`);
  }
  if (action.scope === 'deployment' && principal.kind !== 'operator') {
    return refusal(`"${action.ref}" is reachable by operator principals only.`);
  }
  if (principal.kind !== 'operator' && principal.kind !== 'system') {
    if (
      scope.level !== 'deployment' &&
      principal.scope.backend !== null &&
      principal.scope.backend !== scope.backendId
    ) {
      return refusal('The principal was resolved in another backend.');
    }
    if (
      scope.level === 'tenant' &&
      principal.scope.tenant !== null &&
      principal.scope.tenant !== scope.tenantId
    ) {
      return refusal('The principal was resolved in another tenant.');
    }
  }
  const selected = selectRules(rules, action, context, transport, input.input);
  const create = operationOf(action) === 'create';
  const allows: RuleMatch[] = [];
  const denies: { readonly match: RuleMatch; readonly reason: string | undefined }[] = [];
  for (const rule of selected) {
    if (action.entity === undefined) {
      if (rule.effect === 'allow') allows.push({ id: rule.id, effect: 'allow' });
      else denies.push({ match: { id: rule.id, effect: 'deny' }, reason: rule.reason });
      continue;
    }
    const { where, check } = ruleConditions(rule, context);
    // A create is judged by the row it produces, `check ?? where`, as its plan is.
    const created = create ? (check ?? where) : where;
    if (rule.effect === 'allow') {
      if (!isNever(created) && !(!create && check !== null && isNever(check))) {
        allows.push({ id: rule.id, effect: 'allow' });
      }
    } else if (
      isAlways(created) &&
      (create || check === null) &&
      (rule.fields === null || rule.fields.size === 0)
    ) {
      denies.push({ match: { id: rule.id, effect: 'deny' }, reason: rule.reason });
    }
  }
  const [firstDeny] = denies;
  if (firstDeny !== undefined) {
    return { allowed: false, rules: denies.map((d) => d.match), reason: firstDeny.reason };
  }
  // A public action needs no allow, but a deny that covers every row still stops it (section 8.2).
  if (action.auth === 'public') return { allowed: true, rules: [], reason: undefined };
  if (allows.length > 0) return { allowed: true, rules: allows, reason: undefined };
  // Denied by default: name the allow rules that cover the action but not this principal.
  const wouldAllow: RuleMatch[] = [];
  for (const rule of rules) {
    // The core's default rule is no rule a caller could be granted: a refusal does not name it.
    if (rule.effect !== 'allow' || rule.id.startsWith(ownModuleRulePrefix)) continue;
    for (const kind of ['anonymous', 'user', 'service', 'operator', 'system'] as const) {
      if (ruleApplies(rule, action, kind, transport)) {
        wouldAllow.push({ id: rule.id, effect: 'allow' });
        break;
      }
    }
  }
  return { allowed: false, rules: wouldAllow, reason: undefined };
}
