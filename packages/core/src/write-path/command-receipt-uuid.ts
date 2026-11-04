import { deriveUuidV8 } from '../ids/derive-uuid-v8.ts';

/** The UUID a command receipt is stored under: derived from the scope id and the command id. */
export function commandReceiptUuid(scopeId: string, commandId: string): string {
  return deriveUuidV8(scopeId, commandId);
}
