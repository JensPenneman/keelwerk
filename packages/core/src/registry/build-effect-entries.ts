import type { EffectEntry } from './effect-entry.ts';
import type { RuntimeModule } from './runtime-module.ts';

/** The effects of the modules (section 7.9.5) by reference, each with the executor mounted under its key. */
export function buildEffectEntries(
  ordered: readonly RuntimeModule[],
): ReadonlyMap<string, EffectEntry> {
  const effects = new Map<string, EffectEntry>();
  for (const module of ordered) {
    for (const [name, part] of Object.entries(module.effects)) {
      const ref = `${module.id}.${name}`;
      const performer = Reflect.get(part, 'performer') === 'external' ? 'external' : 'executor';
      const executor = module.executors[name];
      effects.set(ref, {
        ref,
        module: module.id,
        name,
        performer,
        executor:
          executor !== undefined && executor !== null && performer === 'executor' ? ref : null,
      });
    }
  }
  return effects;
}
