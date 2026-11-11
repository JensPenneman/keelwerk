import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StandardIssue } from '../fields/standard-schema-v1.ts';
import { issuesOf } from '../invoker/stages/issues-of.ts';

/**
 * The `validation` error of an input that does not decode over its action's input node (section
 * 16.4.2): code `core.validation`, message 'The input does not match the schema of the action.',
 * the issues through `issuesOf`.
 */
export function inputMismatchError(issues: readonly StandardIssue[]): KeelwerkError {
  return new KeelwerkError({
    kind: 'validation',
    code: 'core.validation',
    message: 'The input does not match the schema of the action.',
    issues: issuesOf(issues),
  });
}
