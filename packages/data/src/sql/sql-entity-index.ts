import type { EntityDescriptor } from '@keelwerk/core';

/**
 * The descriptors an adapter has seen: relation targets are found here when a condition walks a
 * relation. The adapter learns every descriptor a store call names, and `lookup` supplies a target
 * no call has named yet (the registry, once the kernel wires it).
 */
export interface SqlEntityIndex {
  learn(entity: EntityDescriptor): void;
  find(ref: string): EntityDescriptor | undefined;
}

export function sqlEntityIndex(
  lookup?: (ref: string) => EntityDescriptor | undefined,
): SqlEntityIndex {
  const known = new Map<string, EntityDescriptor>();
  return {
    learn: (entity) => {
      known.set(entity.ref, entity);
    },
    find: (ref) => known.get(ref) ?? lookup?.(ref),
  };
}
