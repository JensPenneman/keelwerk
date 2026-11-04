import type { StreamRef } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';

/** The error of an append whose expected version is not the stream's (15.1.2): the stream changed since it was read. */
export function streamVersionConflict(
  stream: StreamRef,
  expectedVersion: number | undefined,
  version: number | undefined,
): KeelwerkError {
  return new KeelwerkError({
    kind: 'conflict',
    code: 'core.version_mismatch',
    message: 'The stream changed since it was read.',
    details: {
      stream,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      ...(version === undefined ? {} : { version }),
    },
  });
}
