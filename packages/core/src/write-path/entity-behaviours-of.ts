import type { AnyEntity } from '../dsl/define-entity.ts';
import type { AnyField } from '../fields/field-def.ts';
import type { AnyModule } from '../model/any-module.ts';
import { runtimeModule } from '../registry/runtime-module.ts';
import type { EntityBehaviour } from './entity-behaviour.ts';
import type { EntityBehaviours } from './entity-behaviours.ts';

function defaultsOf(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    const { defaultValue } = field as AnyField;
    if (defaultValue !== undefined) defaults[name] = defaultValue;
  }
  return defaults;
}

/**
 * The behaviour of every entity of the given modules: the author's `evolve` and invariant, and the
 * defaults of the owner's fields and of the fields contributions and conditional parts add. The
 * registry carries the descriptors only, so the runtime builds this once from the modules it
 * composed and hands it to `createCommandRunner`.
 */
export function entityBehavioursOf(modules: readonly AnyModule[]): EntityBehaviours {
  const defaults = new Map<string, Record<string, unknown>>();
  const entities = new Map<string, AnyEntity>();
  for (const module of modules) {
    const runtime = runtimeModule(module);
    for (const [name, entity] of Object.entries(runtime.entities)) {
      const ref = `${runtime.id}.${name}`;
      entities.set(ref, entity);
      defaults.set(ref, { ...defaults.get(ref), ...defaultsOf(entity.fields) });
    }
  }
  for (const module of modules) {
    const runtime = runtimeModule(module);
    const parts = [
      ...runtime.contributes.map((part) => ({ target: part.to.id, entities: part.entities })),
      ...runtime.conditional.map((part) => ({ target: runtime.id, entities: part.entities })),
    ];
    for (const part of parts) {
      for (const [name, patch] of Object.entries(part.entities)) {
        const ref = `${part.target}.${name}`;
        defaults.set(ref, { ...defaults.get(ref), ...defaultsOf(patch.fields) });
      }
    }
  }
  const behaviours = new Map<string, EntityBehaviour>();
  for (const [ref, entity] of entities) {
    behaviours.set(ref, {
      defaults: defaults.get(ref) ?? {},
      evolve: entity.evolve,
      invariant: entity.invariant,
    });
  }
  return (entity) => behaviours.get(entity);
}
