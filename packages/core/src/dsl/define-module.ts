import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { Check } from '../model/check.ts';
import type { MismatchedExecutors } from '../model/mismatched-executors.ts';
import type { ModuleLiteral } from '../model/module-literal.ts';
import type { ModuleOf } from '../model/module-of.ts';
import type { MountsFor } from '../model/mounts-for.ts';
import type { UnknownPolicyTargets } from '../model/unknown-policy-targets.ts';
import type { UnknownRuleActions } from '../model/unknown-rule-actions.ts';
import { patchedEntities } from './patched-entities.ts';
import { stampRefs } from './stamp-refs.ts';

/** The checks of the module literal (decisions 98 and 105). */
export type LiteralChecks<L> = Check<MismatchedExecutors<L>, 'executorsWithoutEffect'> &
  Check<UnknownRuleActions<L>, 'unknownRuleActions'> &
  Check<UnknownPolicyTargets<L>, 'unknownPolicyTargets'>;

/**
 * Mounts the parts typed against `base`. A part is accepted only where its base and mount match:
 * `entityActions: { session: { revoke } }` fails when `revoke` is mounted on `credential`.
 */
export function defineModule<const B extends AnyModuleBase, const L extends ModuleLiteral>(
  base: B,
  literal: L & MountsFor<B> & LiteralChecks<L>,
): ModuleOf<B, L> {
  stampRefs(base, literal);
  const entities = Object.fromEntries(
    Object.entries(base.entities ?? {}).map(([name, entity]) => [
      name,
      { ...entity, actions: literal.entityActions?.[name] ?? {} },
    ]),
  );
  const contributes = Object.entries(base.contributions ?? {}).map(([key, declaration]) => {
    const behaviour = literal.contributes?.[key];
    return {
      key,
      to: declaration.to,
      when: declaration.when,
      entities: patchedEntities(declaration.entities, behaviour),
      actions: behaviour?.actions ?? {},
      policies: behaviour?.policies ?? {},
      reactions: behaviour?.reactions ?? {},
      fills: behaviour?.extensionPoints ?? {},
    };
  });
  const conditional = Object.entries(base.conditions ?? {}).map(([key, declaration]) => {
    const behaviour = literal.conditional?.[key];
    return {
      key,
      when: declaration.when,
      entities: patchedEntities(declaration.entities, behaviour),
      actions: behaviour?.actions ?? {},
      policies: behaviour?.policies ?? {},
      reactions: behaviour?.reactions ?? {},
      fills: behaviour?.extensionPoints ?? {},
    };
  });
  return {
    kind: 'module',
    id: base.id,
    version: base.version,
    base,
    requires: base.requires ?? [],
    optional: base.optional ?? [],
    provides: base.provides ?? [],
    generates: base.generates ?? [],
    extensionPoints: base.extensionPoints ?? {},
    entities,
    actions: literal.actions ?? {},
    services: literal.services ?? {},
    effects: literal.effects ?? {},
    executors: literal.executors ?? {},
    policies: literal.policies ?? {},
    reactions: literal.reactions ?? {},
    fills: literal.extensionPoints ?? {},
    schedules: literal.schedules ?? {},
    lifecycle: literal.lifecycle ?? {},
    topics: literal.topics ?? {},
    changes: literal.changes ?? {},
    ...(literal.migrations === undefined ? {} : { migrations: literal.migrations }),
    contributes,
    conditional,
  } as unknown as ModuleOf<B, L>;
}
