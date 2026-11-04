import type { Condition } from '../conditions/condition.ts';
import { conditionFields } from '../conditions/condition-fields.ts';
import { evaluateCondition } from '../conditions/evaluate-condition.ts';
import type { EvaluateOptions } from '../conditions/evaluate-options.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { QuantifierNode, RelationAnswerer } from './relation-answerer.ts';
import type { RowMatcher } from './row-matcher.ts';

/** What a matcher needs beyond the conditions and rows. */
export interface RowMatcherOptions {
  /** The entity the conditions are written against. */
  readonly entity: string;
  /** Required when a condition holds a relation quantifier. */
  readonly answerer?: RelationAnswerer;
  /** Personal-field normalisers and field kinds (section 14.7.9.3). */
  readonly evaluate?: Omit<EvaluateOptions, 'matching'>;
}

/**
 * Builds the matcher for a set of rows: it asks the answerer once per distinct quantifier node of
 * the conditions, for all rows together, and answers every later question from memory. A
 * quantifier it was not asked about, or a row it was not given, is a programming error and throws.
 */
export async function createRowMatcher(
  conditions: readonly Condition[],
  rows: readonly StorageRow[],
  options: RowMatcherOptions,
): Promise<RowMatcher> {
  const answers = new Map<QuantifierNode, ReadonlySet<string>>();
  const ids = rows.map((row) => String(row.id));
  const known = new Set(ids);
  for (const condition of conditions) {
    for (const node of conditionFields(condition).quantifiers) {
      if (answers.has(node)) continue;
      if (options.answerer === undefined) {
        throw new KeelwerkError({
          kind: 'internal',
          code: 'core.internal',
          message: `A ${node.op} on "${node.relation}" needs a relation answerer.`,
        });
      }
      answers.set(node, await options.answerer(options.entity, node, ids));
    }
  }
  const matching = (node: QuantifierNode, row: StorageRow): boolean => {
    const answer = answers.get(node);
    if (answer === undefined) {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `The ${node.op} on "${node.relation}" was not prefetched.`,
      });
    }
    const id = String(row.id);
    if (!known.has(id)) {
      throw new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: `Row "${id}" was not among the rows the matcher was built for.`,
      });
    }
    return answer.has(id);
  };
  return (condition, row) => evaluateCondition(condition, row, { ...options.evaluate, matching });
}
