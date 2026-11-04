import type { Condition } from './condition.ts';

/** The names a condition reads on its own entity. */
export interface ConditionFields {
  /** Field paths compared directly, in order of first appearance. */
  readonly fields: readonly string[];
  /** Relation names quantified, in order of first appearance; fields inside their `where` belong to the related entity. */
  readonly relations: readonly string[];
  /**
   * The quantifier nodes of this entity's condition, in order of first appearance, not descending
   * into a `where`. A caller runs one `rows.matching` per node and answers the matcher from a map
   * keyed by the node.
   */
  readonly quantifiers: readonly Extract<Condition, { readonly relation: string }>[];
}

/** The fields, relations and quantifier nodes a condition names (masks, planners and indexes read this). */
export function conditionFields(condition: Condition): ConditionFields {
  const fields = new Set<string>();
  const relations = new Set<string>();
  const quantifiers = new Set<Extract<Condition, { readonly relation: string }>>();
  const visit = (node: Condition): void => {
    switch (node.op) {
      case 'never':
        return;
      case 'and':
      case 'or':
        for (const inner of node.conditions) visit(inner);
        return;
      case 'not':
        visit(node.condition);
        return;
      case 'some':
      case 'none':
      case 'every':
      case 'is':
        relations.add(node.relation);
        quantifiers.add(node);
        return;
      default:
        fields.add(node.field);
    }
  };
  visit(condition);
  return { fields: [...fields], relations: [...relations], quantifiers: [...quantifiers] };
}
