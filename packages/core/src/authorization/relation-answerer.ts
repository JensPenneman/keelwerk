import type { Condition } from '../conditions/condition.ts';

/** A relation quantifier node, the key of an answer. */
export type QuantifierNode = Extract<Condition, { readonly relation: string }>;

/**
 * Answers relation quantifiers inside a unit: the ids, among `ids` of the entity `entity`, whose
 * rows meet the quantifier node. It is `rows.matching` bound to a unit and to the entity's
 * descriptor, and it runs once per distinct quantifier node (section 14.3.4).
 */
export type RelationAnswerer = (
  entity: string,
  node: QuantifierNode,
  ids: readonly string[],
) => Promise<ReadonlySet<string>>;
