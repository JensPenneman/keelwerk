import type { DeclarationBudget, DeclarationSize } from './check-declaration-sizes.ts';

/** One line per limit a package exceeds. */
export function declarationFailures(
  sizes: readonly DeclarationSize[],
  budget: DeclarationBudget,
): readonly string[] {
  const checked = sizes.filter(
    (size) => !budget.exempt.some((prefix) => size.name.startsWith(prefix)),
  );
  return checked.flatMap((size) => [
    ...(size.manifestBytes > budget.manifestBytes
      ? [
          `${size.name}: module.generated.d.ts is ${size.manifestBytes} B, over ${budget.manifestBytes} B`,
        ]
      : []),
    ...(size.totalBytes > budget.packageBytes
      ? [`${size.name}: declarations total ${size.totalBytes} B, over ${budget.packageBytes} B`]
      : []),
  ]);
}
