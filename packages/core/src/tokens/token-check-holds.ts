import { timingSafeEqual } from '../crypto/timing-safe-equal.ts';
import { sealTokenCheck } from './seal-token-check.ts';
import type { StateTokenParts } from './state-token-parts.ts';

/** Whether a decoded token carries the sealed check of `check`, the check its selector has now, under the scope's token key. A token of the first format never does: it resynchronises like a forged one. The comparison is constant-time; a check of another length is refused. */
export function tokenCheckHolds(parts: StateTokenParts, check: string, key: Uint8Array): boolean {
  return (
    parts.version === 2 && timingSafeEqual(parts.check, sealTokenCheck({ ...parts, check }, key))
  );
}
