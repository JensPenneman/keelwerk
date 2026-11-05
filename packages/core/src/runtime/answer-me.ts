import type { RelationNode } from '../authorization/condition-to-mongo.ts';
import { exportCaslRules } from '../authorization/export-casl-rules.ts';
import { normalizeRule } from '../authorization/normalize-rule.ts';
import type { MeDocument } from '../core-module/me-document.ts';
import type { Principal } from '../principals/principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { FieldKind } from '../storage/field-kind.ts';
import type { Scope } from '../storage/scope.ts';
import type { RelationReach } from './relation-reach.ts';

function idOf(principal: Principal): string | undefined {
  switch (principal.kind) {
    case 'user':
      return String(principal.subject);
    case 'service':
    case 'operator':
      return principal.id;
    case 'anonymous':
    case 'system':
      return undefined;
  }
}

function keyOf(entity: string, node: RelationNode): string {
  return `${entity}\u0000${JSON.stringify(node)}`;
}

/**
 * The answer of `core.me` (section 8.7): the principal of the session and its effective rules in
 * CASL raw-rule shape. A rule with a relation quantifier carries the ids `reach` resolves for it
 * (up to its cap), and is `serverOnly` when `reach` answers `undefined` or is absent. The export
 * is synchronous, so a first pass collects the quantifiers it meets, they are resolved together,
 * and a second pass writes the rules with the answers.
 */
export async function answerMe(
  principal: Principal,
  scope: Scope,
  registry: Pick<Registry, 'rules'> & Partial<Pick<Registry, 'entities'>>,
  reach?: RelationReach,
): Promise<MeDocument> {
  const id = idOf(principal);
  const rules = [...registry.rules.values()]
    .filter((rule) => rule.disabled !== true)
    .map(normalizeRule);
  const fieldKind = (entity: string, field: string): FieldKind | undefined =>
    registry.entities?.get(entity)?.descriptor.fields[field]?.kind;
  const asked = new Map<string, { entity: string; node: RelationNode }>();
  if (reach !== undefined) {
    exportCaslRules({
      rules,
      principal,
      scope,
      fieldKind,
      reach: (entity, node) => {
        asked.set(keyOf(entity, node), { entity, node });
        return [];
      },
    });
  }
  const resolved = new Map<string, readonly string[] | undefined>();
  await Promise.all(
    [...asked].map(async ([key, one]) => {
      resolved.set(key, await reach?.(one.entity, one.node));
    }),
  );
  return {
    principal: {
      kind: principal.kind,
      ...(id === undefined ? {} : { id }),
      roles: principal.roles,
      memberships: principal.memberships,
      scope: principal.scope,
      via: principal.via,
      ...(principal.expiresAt === undefined ? {} : { expiresAt: principal.expiresAt.toString() }),
      ...(principal.apiVersion === undefined ? {} : { apiVersion: principal.apiVersion }),
    },
    rules: exportCaslRules({
      rules,
      principal,
      scope,
      fieldKind,
      ...(reach === undefined
        ? {}
        : { reach: (entity, node) => resolved.get(keyOf(entity, node)) }),
    }),
  };
}
