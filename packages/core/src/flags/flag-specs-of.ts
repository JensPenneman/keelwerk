import type { Registry } from '../registry/registry.ts';
import type { FlagSpec } from './flag-spec.ts';

/** One spec object per registry and declared key, so a cache can key on the declaration's identity. */
const specs = new WeakMap<Registry, ReadonlyMap<string, FlagSpec>>();

function build(registry: Registry): ReadonlyMap<string, FlagSpec> {
  const known = new Map<string, FlagSpec>();
  for (const module of registry.modules) {
    for (const [name, flag] of Object.entries(module.flags)) {
      const key = `${module.id}.${name}`;
      known.set(key, { ...flag, key });
    }
  }
  return Object.freeze(known);
}

/** Every flag the registry declares by key, built once per registry. */
export function flagSpecsOf(registry: Registry): ReadonlyMap<string, FlagSpec> {
  let known = specs.get(registry);
  if (known === undefined) {
    known = build(registry);
    specs.set(registry, known);
  }
  return known;
}
