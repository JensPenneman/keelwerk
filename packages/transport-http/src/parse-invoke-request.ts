import type { InvokeRequest } from '@keelwerk/core';
import { coreError } from './core-error.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks the shape of one `InvokeRequest`; the input stays opaque, the pipeline validates it. */
export function parseInvokeRequest(
  value: unknown,
  path: readonly (string | number)[],
): InvokeRequest {
  const issue = (member: string, message: string) =>
    coreError('core.malformed_request', { issues: [{ path: [...path, member], message }] });
  if (!isRecord(value)) {
    throw coreError('core.malformed_request', {
      issues: [{ path: [...path], message: 'Expected an object.' }],
    });
  }
  const { action, input, commandId, prefer } = value;
  if (typeof action !== 'string' || action === '') {
    throw issue('action', 'Expected the reference of an action.');
  }
  if (commandId !== undefined && (typeof commandId !== 'string' || commandId === '')) {
    throw issue('commandId', 'Expected a non-empty string.');
  }
  if (prefer !== undefined && prefer !== 'sync' && prefer !== 'async') {
    throw issue('prefer', "Expected 'sync' or 'async'.");
  }
  return {
    action,
    ...(input !== undefined && { input }),
    ...(commandId !== undefined && { commandId }),
    ...(prefer !== undefined && { prefer }),
  };
}
