import type { AuthorizedAction } from '../authorization/authorized-action.ts';
import { readActionNames } from '../authorization/read-action-names.ts';
import { ruleConditions } from '../authorization/rule-conditions.ts';
import { selectRules } from '../authorization/select-rules.ts';
import { sha256 } from '../crypto/sha256.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Scope } from '../storage/scope.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import { principalIdOf } from './principal-id-of.ts';
import type { StateTokenContext } from './state-token-context.ts';
import type { TokenCheckInput } from './token-check.ts';

function readAction(entry: EntityEntry, name: string): AuthorizedAction {
  return {
    ref: `${entry.ref}.${name}`,
    module: entry.module,
    entity: entry.ref,
    name,
    kind: 'query',
    generated: name as never,
    instance: false,
    auth: 'policy',
    scope: entry.descriptor.tenancy === 'backend' ? 'backend' : 'tenant',
  };
}

/**
 * The part of a token's `check` that depends on who reads (section 15.2.6): the rules that govern
 * reads of the entity type for this principal, each as its id and a digest of its conditions
 * (evaluated for the principal, so a flag flip that changes them changes the digest) and field
 * list, and the principal's id, roles and memberships. Rules of other entities, and rules that do
 * not apply to the principal, are not in it.
 */
export function readVisibility(
  context: StateTokenContext,
  entry: EntityEntry,
  scope: Scope,
): Pick<TokenCheckInput, 'rules' | 'principal'> {
  const principalContext = principalContextOf(context.registry, context.principal, scope);
  const found = new Map<string, { id: string; digest: string }>();
  for (const name of readActionNames) {
    for (const rule of selectRules(
      context.rules,
      readAction(entry, name),
      principalContext,
      null,
      undefined,
    )) {
      if (found.has(rule.id)) continue;
      const { where, check } = ruleConditions(rule, principalContext);
      found.set(rule.id, {
        id: rule.id,
        digest: sha256(
          canonicalizeJson({
            effect: rule.effect,
            where: encodeEventValue(where),
            check: encodeEventValue(check),
            fields: rule.fields === null ? null : [...rule.fields].sort(),
          }),
        ),
      });
    }
  }
  const { principal } = context;
  return {
    rules: [...found.values()],
    principal: {
      id: principalIdOf(principal),
      roles: principal.roles,
      memberships: principal.memberships,
    },
  };
}
