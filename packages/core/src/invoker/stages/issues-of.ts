import type { ErrorIssue } from '../../errors/error-issue.ts';
import type { StandardIssue } from '../../fields/standard-schema-v1.ts';

/** Standard Schema issues as the issues of a `KeelwerkError`. */
export function issuesOf(issues: readonly StandardIssue[]): readonly ErrorIssue[] {
  return issues.map((issue) => ({
    path: (issue.path ?? []).map((segment) =>
      typeof segment === 'object' ? segment.key : segment,
    ),
    message: issue.message,
  }));
}
