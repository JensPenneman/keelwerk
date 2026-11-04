import type { ImportEntry } from './import-entry.ts';
import type { PartPlacement } from './part-placement.ts';

/** The imports every part file shares: the core names it uses, `within` when scoped, the base and the declaration. */
export function placementImports(
  placement: PartPlacement,
  coreNames: readonly string[],
): ImportEntry[] {
  return [
    { from: '@keelwerk/core', names: [...coreNames, ...(placement.scoped ? ['within'] : [])] },
    { from: placement.baseFrom, names: [placement.baseName] },
    ...(placement.declaration === undefined
      ? []
      : [{ from: placement.declaration.from, names: [placement.declaration.name] }]),
  ];
}
