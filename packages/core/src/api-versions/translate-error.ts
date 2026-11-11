import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { olderIssuePath } from './older-issue-path.ts';
import type { VersionTranslation } from './version-translation.ts';

/**
 * The error as an older version shows it: the same error with the code the version's changes give
 * it and, when the action is known, the paths of its issues in the version's field names (kind,
 * message, details, retry hints and rules kept). An error that changes in neither is returned as
 * it is. The `details` of a declared error are the author's data and are never rewritten.
 */
export function translateError(
  translation: VersionTranslation,
  error: KeelwerkError,
  action?: ActionEntry,
): KeelwerkError {
  const code = translation.errorCodes.get(error.code) ?? error.code;
  let moved = false;
  const issues =
    action === undefined || translation.lacking.length === 0
      ? error.issues
      : error.issues?.map((issue) => {
          const path = olderIssuePath(translation, action, issue.path);
          if (path === issue.path) return issue;
          moved = true;
          return { ...issue, path };
        });
  if (code === error.code && !moved) return error;
  return new KeelwerkError({
    kind: error.kind,
    code,
    message: error.message,
    retryable: error.retryable,
    ...(issues === undefined ? {} : { issues }),
    ...(error.details === undefined ? {} : { details: error.details }),
    ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
    ...(error.rules === undefined ? {} : { rules: error.rules }),
    ...(error.reason === undefined ? {} : { reason: error.reason }),
    ...(error.cause === undefined ? {} : { cause: error.cause }),
  });
}
