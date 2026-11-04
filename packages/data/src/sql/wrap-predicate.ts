import type { Expression } from 'kysely';
import type { CompiledPredicate } from './compile-condition.ts';

export function wrapPredicate(
  expression: Expression<boolean>,
  nullable: boolean,
): CompiledPredicate {
  return { expression, nullable };
}
