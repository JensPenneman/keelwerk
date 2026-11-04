import type { CliContext } from '../context/cli-context.ts';
import { CliFailure } from '../context/cli-failure.ts';
import { exitCodeFor } from '../exit-code-for.ts';

function isAbort(failure: unknown): boolean {
  return failure instanceof Error && failure.name === 'AbortError';
}

/**
 * Ends a command that failed: writes the error once, sets the exit code (section 16.4.6), and
 * returns. Anything that is not a CLI failure or an interrupt is a bug and propagates.
 */
export function handleFailure(context: CliContext, failure: unknown): void {
  if (failure instanceof CliFailure) {
    if (failure.outcome === 'usage') {
      context.output.note(`error: ${failure.message}`);
    } else if (failure.outcome !== 'interrupted') {
      context.output.error(failure.outcome);
    }
    context.process.exitCode = exitCodeFor(failure.outcome);
    return;
  }
  if (isAbort(failure) || context.signal.aborted) {
    context.process.exitCode = exitCodeFor('interrupted');
    return;
  }
  throw failure;
}
