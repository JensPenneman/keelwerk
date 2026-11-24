import { CliFailure } from './cli-failure.ts';

/** Whether a failure is the one the link raises when the deployment cannot be reached. */
export function isUnreachable(failure: unknown): failure is CliFailure {
  return (
    failure instanceof CliFailure &&
    typeof failure.outcome === 'object' &&
    failure.outcome.code === 'cli.unreachable'
  );
}
