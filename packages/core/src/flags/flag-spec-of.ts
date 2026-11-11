import type { Registry } from '../registry/registry.ts';
import type { FlagSpec } from './flag-spec.ts';
import { flagSpecsOf } from './flag-specs-of.ts';

/**
 * The registry's flag `<module id>.<flag>` as providers read it; undefined for an unknown key. A
 * lookup only reads the declared flags: a caller's key (an anonymous `core.flag.evaluate` carries
 * any text) never adds to them.
 */
export function flagSpecOf(registry: Registry, key: string): FlagSpec | undefined {
  return flagSpecsOf(registry).get(key);
}
