import { deriveUuidV8 } from '../ids/derive-uuid-v8.ts';
import type { Scope } from '../storage/scope.ts';
import { scopeKeyOf } from './scope-key-of.ts';

/**
 * The id of the effect at `index` of a decision (section 7.9.5): a UUIDv8 of the scope, the cause
 * and the index, so a decision that repeats (a retried unit, a redelivered event) requests the same
 * ids and an idempotent destination deduplicates. The cause is a command id, or
 * `<reaction id>:<event id>` for a reaction. The id names the `core.effect` row, the job of an
 * effect with an executor, and the command an `invoke` runs under.
 */
export function deriveEffectId(scope: Scope, cause: string, index: number): string {
  return deriveUuidV8('effect', scopeKeyOf(scope), cause, String(index));
}
