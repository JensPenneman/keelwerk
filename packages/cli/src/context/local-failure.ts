import type { ErrorKind } from '@keelwerk/core';
import { CliFailure } from './cli-failure.ts';

/** An error the CLI raises itself, in the shape of a wire error (code `cli.<snake_case>`, request id `local`). */
export function localFailure(kind: ErrorKind, code: string, message: string): CliFailure {
  return new CliFailure(
    { kind, code, message, retryable: kind === 'unavailable', requestId: 'local' },
    message,
  );
}
