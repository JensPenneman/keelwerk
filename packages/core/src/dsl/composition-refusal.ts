import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { CompositionProblem } from '../registry/composition-problem.ts';

/**
 * The error a definition function throws for a named problem (section 10: refusals are named
 * problems, not error codes): the registered code `core.internal`, the problem in `details`.
 */
export function compositionRefusal(problem: CompositionProblem): KeelwerkError {
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: `${problem.code}: ${problem.message}`,
    details: problem,
  });
}
