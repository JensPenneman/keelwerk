import type { DeclarationBudget, DeclarationSize } from './check-declaration-sizes.ts';

/** One line per limit a package exceeds. */
export function declarationFailures(
  sizes: readonly DeclarationSize[],
  budget: DeclarationBudget,
): readonly string[] {
  const checked = sizes.filter(
    (size) => !budget.exempt.some((prefix) => size.name.startsWith(prefix)),
  );
  return checked.flatMap((size) => {
    const override = budget.overrides?.[size.name];
    const manifestBytes = override?.manifestBytes ?? budget.manifestBytes;
    const packageBytes = override?.packageBytes ?? budget.packageBytes;
    return [
      ...(size.manifestBytes > manifestBytes
        ? [
            `${size.name}: module.generated.d.ts is ${size.manifestBytes} B, over ${manifestBytes} B`,
          ]
        : []),
      ...(size.totalBytes > packageBytes
        ? [`${size.name}: declarations total ${size.totalBytes} B, over ${packageBytes} B`]
        : []),
    ];
  });
}
