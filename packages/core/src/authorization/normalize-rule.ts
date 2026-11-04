import { compositionRefusal } from '../dsl/composition-refusal.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { RuleEntry } from '../registry/rule-entry.ts';
import { expandActionAliases } from './expand-action-aliases.ts';
import type { NormalizedRule, RuleTarget } from './normalized-rule.ts';

function targetOf(subject: RuleEntry['subject']): RuleTarget {
  if ('module' in subject) {
    return subject.entity === undefined
      ? { kind: 'module', module: subject.module }
      : { kind: 'entity', ref: `${subject.module}.${subject.entity}` };
  }
  return {
    kind: 'selector',
    kinds: subject.kinds ?? null,
    transports: subject.transports ?? null,
  };
}

function kindsOf(principal: RuleEntry['principal']): ReadonlySet<PrincipalKind> | null {
  if (principal === undefined) return null;
  return new Set(typeof principal === 'string' ? [principal] : principal);
}

/**
 * Resolves a registry rule for the engine: target, expanded actions, principal kinds and field
 * list. A deny rule without a reason is refused (decision 5, section 8.2).
 */
export function normalizeRule(entry: RuleEntry): NormalizedRule {
  if (entry.effect === 'deny' && (entry.reason === undefined || entry.reason.trim() === '')) {
    throw compositionRefusal({
      code: 'denyWithoutReason',
      severity: 'error',
      message: `The deny rule "${entry.id}" carries no reason.`,
      module: entry.module,
      ref: entry.id,
    });
  }
  return {
    id: entry.id,
    effect: entry.effect,
    module: entry.module,
    target: targetOf(entry.subject),
    actions: expandActionAliases(entry.actions),
    principals: kindsOf(entry.principal),
    fields: entry.fields === undefined ? null : new Set(entry.fields),
    reason: entry.reason,
    entry,
  };
}
