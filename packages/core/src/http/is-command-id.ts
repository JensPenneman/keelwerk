const visibleAscii = /^[\x21-\x7e]{1,255}$/;

/**
 * Whether a caller-chosen command id (the idempotency key) is acceptable (section 16.4.8): an
 * opaque string of 1 to 255 visible ASCII characters. REST checks its `Idempotency-Key` header
 * with it and GraphQL its `commandId` member, so one id behaves alike over both; an empty or huge
 * id never reaches the receipt table.
 */
export function isCommandId(value: string): boolean {
  return visibleAscii.test(value);
}
