import type { KeelwerkError } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';

/** The refusal of two different versions, in a request or in a socket's upgrade and hello. */
export function versionConflictOf(versions: readonly string[]): KeelwerkError {
  return coreError('core.validation', {
    message: `The request names two API versions: ${versions.join(' and ')}.`,
    issues: versions.map((version) => ({
      path: ['keelwerk-version'],
      message: `Names ${version}.`,
    })),
  });
}
