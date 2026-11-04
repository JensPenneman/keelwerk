import type { WireError } from '@keelwerk/core';

/**
 * An error for standard error: one line per problem, the issues with their paths, and the request
 * id (section 16.9.5); with `json` the `WireError` itself.
 */
export function renderError(error: WireError, json: boolean): string {
  if (json) {
    return JSON.stringify(error);
  }
  const lines = [`error[${error.code}]: ${error.message}`];
  for (const issue of error.issues ?? []) {
    lines.push(`  ${issue.path.join('.') || '(input)'}: ${issue.message}`);
  }
  if (error.reason !== undefined) {
    lines.push(`  reason: ${error.reason}`);
  }
  if (error.retryAfter !== undefined) {
    lines.push(`  retry after ${error.retryAfter}s`);
  }
  lines.push(`  request id: ${error.requestId}`);
  return lines.join('\n');
}
