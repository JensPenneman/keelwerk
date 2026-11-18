import type { InvokeRequest } from '@keelwerk/core';
import { refuseReservedCommandId } from '@keelwerk/core';
import { coreError, isCommandId } from '@keelwerk/core/http';

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
  // The kernel's own form is refused as reserved, before the grammar of a caller's id applies.
  if (typeof commandId === 'string') refuseReservedCommandId(commandId);
  if (commandId !== undefined && (typeof commandId !== 'string' || !isCommandId(commandId))) {
    throw issue('commandId', 'Expected a UUID of version 4 or 7, or a ULID.');
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
