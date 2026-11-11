import { errors } from '../errors/errors.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { CompiledGate } from './compiled-gate.ts';
import { flagSpecOf } from './flag-spec-of.ts';

/**
 * The action's gates: its own (`action.gate`) then its module's (`ModuleEntry.gate`), both of the
 * module `action.contributedBy ?? action.module`. Throws `internal` when a gate names no flag of
 * the registry.
 */
export function compileGate(registry: Registry, action: ActionEntry): readonly CompiledGate[] {
  const owner = action.contributedBy ?? action.module;
  const module = registry.modules.find((entry) => entry.id === owner);
  const gates: { readonly rule: string; readonly name: string }[] = [];
  if (action.gate !== undefined) gates.push({ rule: `${action.ref}.gate`, name: action.gate });
  if (module?.gate !== undefined) gates.push({ rule: `${owner}.gate`, name: module.gate });
  return gates.map(({ rule, name }): CompiledGate => {
    const key = `${owner}.${name}`;
    const spec = flagSpecOf(registry, key);
    if (spec === undefined) {
      throw errors.internal(`The gate of "${action.ref}" names "${key}", which is not a flag.`);
    }
    return { rule, key, stage: spec.purpose === 'kill-switch' ? 'admit' : 'authorize' };
  });
}
