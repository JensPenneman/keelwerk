import type { KeyService } from '../kernel/key-service.ts';
import { sealedFieldsOf } from '../keys/sealed-fields-of.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import { fingerprintKeyInfo } from './fingerprint-key-info.ts';
import { inputFingerprint } from './input-fingerprint.ts';
import { keyedInputFingerprint } from './keyed-input-fingerprint.ts';

/** What the fingerprint of one command depends on. */
export interface FingerprintSource {
  readonly registry: Registry;
  readonly action: ActionEntry;
  readonly keys: KeyService;
  readonly scope: Scope;
  readonly apiVersion: string;
  /** Set for the job of a reaction: its fingerprint holds no version (see `commandFingerprint`). */
  readonly job?: { readonly reaction?: true };
  readonly input: unknown;
  /** The client's own input, when `input` holds values sealed on the way in. */
  readonly fingerprintInput?: unknown;
}

/**
 * The input fingerprint of a command (section 15.1.7): the plain sha256 of the canonical input, or
 * a keyed digest when the input carries sealed or secret members (S-111). The version argument is
 * the empty text for a reaction's job, which runs at the head of the build that runs it: a copy of
 * the job that runs after a deploy moved the head replays its receipt instead of meeting
 * `core.idempotency_mismatch`. This is a stored format.
 */
export async function commandFingerprint(source: FingerprintSource): Promise<string> {
  /** Whether the command's input carries a member the control path sealed or its entity seals per value. */
  const carriesSecrets = (): boolean => {
    if (source.fingerprintInput !== undefined) return true;
    const { action, input } = source;
    if (action.entity === undefined || typeof input !== 'object' || input === null) return false;
    const entry = source.registry.entities.get(action.entity);
    if (entry === undefined) return false;
    return sealedFieldsOf(entry).some((field) => Reflect.get(input, field) !== undefined);
  };
  const input = source.fingerprintInput ?? source.input;
  const version = source.job?.reaction === true ? '' : source.apiVersion;
  if (!carriesSecrets()) {
    return inputFingerprint(source.action.ref, version, input);
  }
  const key = await source.keys.derive(source.scope, fingerprintKeyInfo, 32);
  return keyedInputFingerprint(key, source.action.ref, version, input);
}
