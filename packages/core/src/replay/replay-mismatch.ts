import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * The error of a re-decide whose handler asks for something the decision record does not hold
 * (more loads, another id): the build no longer makes the decision it recorded. `redecide` turns
 * it into a difference of its report.
 */
export function replayMismatch(message: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.internal',
    message: `The re-decide diverged from the record: ${message}`,
    details: { replay: 'mismatch' },
  });
}
