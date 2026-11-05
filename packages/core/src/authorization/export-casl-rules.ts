import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { Principal } from '../principals/principal.ts';
import type { FieldKind } from '../storage/field-kind.ts';
import type { Scope } from '../storage/scope.ts';
import type { CaslRule } from './casl-rule.ts';
import type { RelationNode } from './condition-to-mongo.ts';
import { conditionToMongo } from './condition-to-mongo.ts';
import { isAlways } from './is-always.ts';
import { isNever } from './is-never.ts';
import type { NormalizedRule } from './normalized-rule.ts';
import { ruleConditions } from './rule-conditions.ts';

function subjectOf(rule: NormalizedRule): string {
  const { target } = rule;
  if (target.kind === 'entity') return target.ref;
  return target.kind === 'module' ? target.module : 'all';
}

/** The action names the rule covers once aliases are expanded; `read` and `manage` stand for their groups. */
function actionsOf(rule: NormalizedRule): readonly string[] {
  const { all, reads, names } = rule.actions;
  if (all) return ['manage'];
  return [...(reads ? ['read'] : []), ...[...names].filter((name) => name !== 'read').sort()];
}

/** What `exportCaslRules` reads. */
export interface ExportCaslRulesInput {
  readonly rules: readonly NormalizedRule[];
  readonly principal: Principal;
  readonly scope: Scope;
  /**
   * The ids of the rows of `entity` that meet a relation quantifier for this principal, or
   * `undefined` when that set is unbounded. Without it every rule with a quantifier is `serverOnly`.
   */
  readonly reach?: (entity: string, node: RelationNode) => readonly string[] | undefined;
  /** The kind of a field of an entity, for the conditions whose form depends on it (`contains`). */
  readonly fieldKind?: (entity: string, field: string) => FieldKind | undefined;
}

/**
 * The principal's effective rules in CASL's raw-rule shape (section 8.7): the rules that cover the
 * principal's kind, with their conditions evaluated for the principal (its id, roles and
 * memberships are already values in the conditions) and written in the mongo form CASL's matcher
 * reads. A rule with a relation quantifier carries the ids `reach` resolved, or is `serverOnly`
 * when the set is unbounded or the rule cannot be evaluated here. A rule that matches no row is
 * left out. Allow rules come first and deny (`inverted`) rules after them, each group in rule id order, so a deny overrides in CASL as it does here and one principal exports one list.
 */
export function exportCaslRules(input: ExportCaslRulesInput): readonly CaslRule[] {
  const context: PrincipalContext = { principal: input.principal, scope: input.scope, flags: {} };
  const out: CaslRule[] = [];
  const ordered = [...input.rules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const rule of ordered) {
    if (rule.entry.disabled) continue;
    if (rule.principals !== null && !rule.principals.has(input.principal.kind)) continue;
    const base = {
      action: actionsOf(rule),
      subject: subjectOf(rule),
      ...(rule.effect === 'deny' ? { inverted: true as const } : {}),
      ...(rule.fields === null ? {} : { fields: [...rule.fields].sort() }),
      ...(rule.reason === undefined ? {} : { reason: rule.reason }),
    };
    const serverOnly: CaslRule = { ...base, serverOnly: true };
    // A selector rule covers actions by kind or transport, which a client cannot evaluate.
    if (rule.target.kind === 'selector') {
      out.push(serverOnly);
      continue;
    }
    try {
      if (rule.entry.when !== undefined && rule.entry.when(context, undefined) !== true) continue;
      const { where, check } = ruleConditions(rule, context);
      // The row acted on; a rule that selects every row but constrains the produced row shows that constraint.
      const condition = isAlways(where) && check !== null ? check : where;
      if (isNever(condition)) continue;
      const entity = subjectOf(rule);
      // A deny rule never resolves a quantifier: a bounded set of ids would turn "deny these" into "allow the rest".
      const reach =
        input.reach === undefined || rule.effect === 'deny'
          ? undefined
          : (node: RelationNode) => input.reach?.(entity, node);
      const mongo = conditionToMongo(condition, reach, (field) => input.fieldKind?.(entity, field));
      if (mongo === undefined) out.push(serverOnly);
      else out.push(Object.keys(mongo).length === 0 ? base : { ...base, conditions: mongo });
    } catch {
      out.push(serverOnly);
    }
  }
  // CASL lets the later rule win and Keelwerk lets a deny override (section 8.7): denies come last.
  return [
    ...out.filter((rule) => rule.inverted !== true),
    ...out.filter((rule) => rule.inverted === true),
  ];
}
