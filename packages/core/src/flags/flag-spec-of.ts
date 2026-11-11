import type { Registry } from '../registry/registry.ts';
import type { FlagSpec } from './flag-spec.ts';

/** The registry's flag `<module id>.<flag>` as providers read it; undefined for an unknown key. */
export function flagSpecOf(registry: Registry, key: string): FlagSpec | undefined {
  const split = key.lastIndexOf('.');
  if (split < 0) return undefined;
  const module = registry.modules.find((entry) => entry.id === key.slice(0, split));
  const flag = module?.flags[key.slice(split + 1)];
  return flag === undefined ? undefined : { ...flag, key };
}
