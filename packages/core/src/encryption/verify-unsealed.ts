import type { Condition } from '../conditions/condition.ts';
import { evaluateCondition } from '../conditions/evaluate-condition.ts';
import { errors } from '../errors/errors.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { normalizedText } from './normalized-text.ts';
import { normalizerOf } from './normalizer-of.ts';
import type { SealingContext } from './sealing-context.ts';

/**
 * The rows that satisfy the original condition on their unsealed values (14.7.9.5, step 4): the
 * kernel's interpreter with the field's normaliser applied to the stored value and the operand
 * alike. A tag collision or a truncated tag cannot disclose a row past this check, and the bounded
 * scan of S-37 decides its prefix here. The condition holds no relation quantifier (the planner
 * leaves those to the database).
 */
export function verifyUnsealed(
  context: Pick<SealingContext, 'normalizers'>,
  entity: EntityDescriptor,
  original: Condition,
  rows: readonly StorageRow[],
): readonly StorageRow[] {
  const mapValue = (name: string, value: unknown): unknown => {
    const field = Object.hasOwn(entity.fields, name) ? entity.fields[name] : undefined;
    if (field === undefined || field.personal === false) return value;
    return normalizedText(field, normalizerOf(context, field.personal), value) ?? value;
  };
  return rows.filter((row) =>
    evaluateCondition(original, row, {
      mapValue,
      kindOf: (name) => entity.fields[name]?.kind,
      matching: () => {
        throw errors.internal('A verified condition holds no relation quantifier.');
      },
    }),
  );
}
