import type { CommandReceipt } from '@keelwerk/core';

/** Narrows the result of an `either` command (or a tRPC call) to the receipt of an asynchronous answer. */
export function isReceipt(value: unknown): value is CommandReceipt {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly commandId?: unknown }).commandId === 'string' &&
    (value as { readonly status?: unknown }).status === 'accepted'
  );
}
