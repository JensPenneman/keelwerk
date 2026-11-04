import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { ModuleLiteral } from '../model/module-literal.ts';
import { compositionRefusal } from './composition-refusal.ts';

type Mounted = { readonly [name: string]: object };

function stamp(part: object, ref: string): void {
  if (Object.hasOwn(part, 'ref')) {
    const existing: unknown = Reflect.get(part, 'ref');
    if (existing === ref) return;
    throw compositionRefusal({
      code: 'partMountedTwice',
      severity: 'error',
      message: `A part mounted as ${ref} is already mounted as ${String(existing)}; one part has one reference.`,
      ref,
    });
  }
  Object.defineProperty(part, 'ref', { value: ref, enumerable: true });
}

function stampAll(parts: Mounted | undefined, prefix: string): void {
  for (const [name, part] of Object.entries(parts ?? {})) stamp(part, `${prefix}.${name}`);
}

function stampEntityActions(
  byEntity: { readonly [entity: string]: Mounted } | undefined,
  prefix: string,
): void {
  for (const [entity, parts] of Object.entries(byEntity ?? {})) {
    stampAll(parts, `${prefix}.${entity}`);
  }
}

/** A rule directly under `policies` is a module-level rule; any other object groups an entity's rules. */
function stampPolicies(policies: Mounted | undefined, prefix: string): void {
  for (const [name, part] of Object.entries(policies ?? {})) {
    if (Reflect.get(part, 'kind') === 'rule') stamp(part, `${prefix}.${name}`);
    else stampAll(part as Mounted, `${prefix}.${name}`);
  }
}

/**
 * Records the reference of every action part and effect a module literal mounts
 * (`auth.credential.revoke`), so `invoke`, `enqueue`, `setTimer` and `continueWith` can name a part
 * by value. Contributed module-level and entity actions mount under the target module's id. A part
 * mounted under two references is refused as `partMountedTwice`.
 */
export function stampRefs(base: AnyModuleBase, literal: ModuleLiteral): void {
  stampAll(literal.actions, base.id);
  stampEntityActions(literal.entityActions, base.id);
  stampAll(literal.effects, base.id);
  stampAll(literal.services, base.id);
  stampAll(literal.reactions, base.id);
  stampAll(literal.schedules, base.id);
  stampPolicies(literal.policies, base.id);
  for (const [key, behaviour] of Object.entries(literal.contributes ?? {})) {
    const target = base.contributions?.[key]?.to.id ?? base.id;
    stampAll(behaviour.actions, target);
    stampEntityActions(behaviour.entityActions, target);
    stampAll(behaviour.reactions, target);
    stampPolicies(behaviour.policies, target);
  }
  for (const behaviour of Object.values(literal.conditional ?? {})) {
    stampAll(behaviour.actions, base.id);
    stampEntityActions(behaviour.entityActions, base.id);
    stampAll(behaviour.reactions, base.id);
    stampPolicies(behaviour.policies, base.id);
  }
}
