import { CliFailure } from './context/cli-failure.ts';
import { exitCodeFor } from './exit-code-for.ts';

/** Stricli's `determineExitCode`: a CLI failure by its outcome, an abort as an interrupt, anything else 1. */
export function determineExitCode(failure: unknown): number {
  if (failure instanceof CliFailure) {
    return exitCodeFor(failure.outcome);
  }
  if (failure instanceof Error && failure.name === 'AbortError') {
    return exitCodeFor('interrupted');
  }
  return 1;
}
