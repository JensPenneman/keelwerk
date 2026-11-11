import type { ErrorIssue } from '../errors/error-issue.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

/** `core.version_change_failed` (internal): a version change's transform, or the head schema after it, broke. */
export function versionChangeFailure(input: {
  readonly change: string | undefined;
  readonly action: string;
  readonly direction: 'input' | 'output';
  readonly message: string;
  readonly cause?: unknown;
  readonly issues?: readonly ErrorIssue[];
}): KeelwerkError {
  return new KeelwerkError({
    kind: 'internal',
    code: 'core.version_change_failed',
    message: input.message,
    details: {
      ...(input.change === undefined ? {} : { change: input.change }),
      action: input.action,
      direction: input.direction,
    },
    ...(input.issues === undefined ? {} : { issues: input.issues }),
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}
