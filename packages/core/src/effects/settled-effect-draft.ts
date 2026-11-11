import { sha256 } from '../crypto/sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { UpdateDraft } from '../protocol/update-draft.ts';
import type { EffectAttemptError } from './effect-attempt-error.ts';

/**
 * The `settled` change of a `core.effect` row (7.9.6, S-169): `succeeded` with the output (already
 * sealed by `sealEffectOutput`) and the SHA-256 digest of its canonical form, or `failed` or
 * `abandoned` (`abandoned: true`) with the closed projection of the error, never the executor's
 * text. `attempts` counts the attempts that started; `at` is the settling time.
 */
export function settledEffectDraft(
  id: string,
  at: Temporal.Instant,
  outcome:
    | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
    | { readonly ok: false; readonly error: EffectAttemptError; readonly abandoned?: true },
  attempts: number,
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
          attempts,
          output: outcome.value,
          outputDigest: sha256(canonicalizeJson(outcome.value)),
          settledAt: at,
        }
      : {
          status: outcome.abandoned === true ? 'abandoned' : 'failed',
          attempts,
          error: { ...outcome.error },
          settledAt: at,
        },
  });
}
