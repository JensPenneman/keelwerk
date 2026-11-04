import { sha256 } from '../crypto/sha256.ts';
import type { WireError } from '../errors/wire-error.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { UpdateDraft } from '../protocol/update-draft.ts';

/**
 * The `settled` change of a `core.effect` row (section 7.9.6): `succeeded` with the output and the
 * SHA-256 digest of its canonical form, or `failed` with the error; one attempt and the time.
 */
export function settledEffectDraft(
  id: string,
  at: Temporal.Instant,
  outcome:
    | { readonly ok: true; readonly value: Record<string, unknown> }
    | { readonly ok: false; readonly error: Omit<WireError, 'requestId'> },
): UpdateDraft {
  return Object.freeze({
    kind: 'update',
    type: 'changed',
    target: 'core.effect',
    entity: 'core.effect',
    id,
    values: outcome.ok
      ? {
          status: 'succeeded',
          attempts: 1,
          output: outcome.value,
          outputDigest: sha256(canonicalizeJson(outcome.value)),
          settledAt: at,
        }
      : { status: 'failed', attempts: 1, error: { ...outcome.error }, settledAt: at },
  });
}
