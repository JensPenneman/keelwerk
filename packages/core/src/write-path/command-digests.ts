import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { actionInputFields } from './action-input-fields.ts';
import { decisionBasePrefix } from './decision-base-prefix.ts';
import { encodeEventValue } from './encode-event-value.ts';
import { fingerprintPrefix } from './fingerprint-prefix.ts';
import { generatedRecordsOf } from './generated-records.ts';
import { keyedInputFingerprint } from './keyed-input-fingerprint.ts';
import { legacyFingerprint } from './legacy-fingerprint.ts';
import { type MaskMode, maskInputMembers } from './mask-input-members.ts';
import { replaceAt } from './replace-at.ts';

/**
 * The input with every member `mode` withholds replaced by the marker: the members of the declared
 * input and, for a generated `update` or `set`, those of the entity's records inside it (a set's
 * input schema is permissive, so its items are reached here).
 */
function maskedInput(source: FingerprintSource, given: unknown, mode: MaskMode): unknown {
  const { action, registry } = source;
  let masked = maskInputMembers(actionInputFields(action) ?? {}, given, mode);
  const entity = action.entity === undefined ? undefined : registry.entities.get(action.entity);
  if (entity === undefined) return masked;
  for (const generated of generatedRecordsOf(action, masked)) {
    masked = replaceAt(
      masked,
      generated.path,
      maskInputMembers(entity.descriptor.fields, generated.record, mode),
    );
  }
  return masked;
}

/** What the digests of one command depend on (`RunCommandInput` fits, with the key added). */
export interface FingerprintSource {
  readonly registry: Registry;
  readonly action: ActionEntry;
  /** `ScopeSecrets.fingerprintKey`, derived before the unit opens. */
  readonly fingerprintKey: Uint8Array;
  readonly apiVersion: string;
  /** Set for the job of a reaction or a tenant hook: neither digest holds a version. */
  readonly job?: { readonly reaction?: true; readonly hook?: true };
  readonly input: unknown;
  /** The client's own input, when `input` holds values sealed on the way in (control path). */
  readonly fingerprintInput?: unknown;
  /** Control path: applied to `fingerprintInput ?? input` before both digests. */
  readonly fingerprintMask?: (input: unknown) => unknown;
}

/** The two digests of a command, and its 0.1.0 form on demand. */
export interface CommandDigests {
  /** `kwf1.` and 64 hex characters: stored in the receipt only. */
  readonly fingerprint: string;
  /** `kwb1.` and 64 hex characters: the base of the event meta's inputDigest. */
  readonly decisionBase: string;
  /** The 0.1.0 form of the same source, computed only when called (`legacyFingerprint`). */
  readonly legacyFingerprint: () => string;
}

/**
 * The two digests of a command (section 15.1.7, 7.9.6), both HMAC-SHA-256 under the scope's
 * fingerprint key over the canonical action, API version and input, with the value of every secret
 * and verifier member replaced by `withheldMember`. The receipt fingerprint (`kwf1.`) keeps the
 * personal members inside, so a retry with another personal value is still
 * `core.idempotency_mismatch`; the decision base (`kwb1.`) withholds them too, because the event
 * meta is permanent. The version is the empty text for the job of a reaction or a tenant hook.
 * Pure and synchronous: it reads no unit and no key service, so a first write and its retry have
 * the same two texts. These are stored formats.
 */
export function commandDigests(source: FingerprintSource): CommandDigests {
  const { action, fingerprintKey } = source;
  const version =
    source.job?.reaction === true || source.job?.hook === true ? '' : source.apiVersion;
  const origin = source.fingerprintInput ?? source.input;
  const given = source.fingerprintMask === undefined ? origin : source.fingerprintMask(origin);
  const baseInput = maskedInput(source, given, 'credentials-and-personal');
  return {
    fingerprint:
      fingerprintPrefix +
      keyedInputFingerprint(
        fingerprintKey,
        action.ref,
        version,
        maskedInput(source, given, 'credentials'),
      ),
    decisionBase:
      decisionBasePrefix +
      hmacSha256(
        fingerprintKey,
        canonicalizeJson({
          action: action.ref,
          apiVersion: version,
          digest: 'decision',
          input: encodeEventValue(baseInput) ?? null,
        }),
      ),
    legacyFingerprint: () => legacyFingerprint(source),
  };
}
