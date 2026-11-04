import { CliFailure } from './cli-failure.ts';

/** A usage mistake (exit code 2): unknown profile, unparsable value, missing connection. */
export function usageFailure(message: string): CliFailure {
  return new CliFailure('usage', message);
}
