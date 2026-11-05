import type { SubjectId } from '@keelwerk/core';

/** A fresh opaque subject id from recorded random bytes (8.5). */
export function opaqueSubject(bytes: Uint8Array): SubjectId {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') as SubjectId;
}
