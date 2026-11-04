import type { FieldKind } from '../storage/field-kind.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Condition } from './condition.ts';

/**
 * Decides one relation quantifier node for a row (section 14.3.4): `some`, `none`, `every` (true
 * for an empty relation) or `is` (false on an absent reference), with the node's `where`
 * evaluated against the related rows. The node itself is the key a caller answers from.
 */
export type RelationMatcher = (
  node: Extract<Condition, { readonly relation: string }>,
  row: StorageRow,
) => boolean;

/** What `evaluateCondition` takes besides the condition and the row. */
export interface EvaluateOptions {
  /** Required when the condition holds a relation quantifier. */
  readonly matching?: RelationMatcher;
  /**
   * Applied to the stored value and to the operand (each element of an `in` or `nin` list, each
   * element of a stored set or list under `contains`) of a comparison before it runs: the
   * normaliser `N` of a personal field (section 14.7.9.3).
   */
  readonly mapValue?: (field: string, value: unknown) => unknown;
  /**
   * The kind of a field. A `decimal` is a string in the field model and compares by numeric
   * value; every other field compares by its JavaScript value.
   */
  readonly kindOf?: (field: string) => FieldKind | undefined;
}
