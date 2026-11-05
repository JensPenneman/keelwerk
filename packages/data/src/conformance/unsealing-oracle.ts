import type { Condition, EntityDescriptor, StorageRow } from '@keelwerk/core';
import { evaluateCondition, normalizedText, normalizerRegistry } from '@keelwerk/core';

const normalizers = normalizerRegistry();

/**
 * The reference semantics of an encrypted query (14.7.9.10, 14.10 case 13): "unseal and
 * evaluate". It takes the rows as they were written (plain values, the unsealed state) and
 * evaluates the original condition with the core interpreter, the field's normaliser applied to
 * the stored value and the operand alike. It reads no adapter and no tag, so a case that compares
 * an adapter's rewritten and verified result with it states the expectation independently.
 */
export function unsealingOracle(
  entity: EntityDescriptor,
  condition: Condition,
  rows: readonly StorageRow[],
): string[] {
  const mapValue = (name: string, value: unknown): unknown => {
    const field = Object.hasOwn(entity.fields, name) ? entity.fields[name] : undefined;
    if (field === undefined || field.personal === false) return value;
    const normalizer = normalizers.resolve(field.personal.normalize);
    if (normalizer === undefined)
      throw new TypeError(`no normaliser ${field.personal.normalize.id}`);
    return normalizedText(field, normalizer, value) ?? value;
  };
  return rows
    .filter((row) => row.archivedAt === undefined || row.archivedAt === null)
    .filter((row) =>
      evaluateCondition(condition, row, {
        mapValue,
        kindOf: (name) => entity.fields[name]?.kind,
        matching: () => {
          throw new TypeError('the unsealing oracle takes no relation quantifier');
        },
      }),
    )
    .map((row) => String(row.id))
    .sort();
}
