import type { KeyService } from '../kernel/key-service.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { Scope } from '../storage/scope.ts';
import { actionInputFields } from './action-input-fields.ts';
import { carriesSecrets } from './carries-secrets.ts';
import { digestPersonalMembers } from './digest-personal-members.ts';
import { fingerprintKeyInfo } from './fingerprint-key-info.ts';
import type { FingerprintKeys } from './fingerprint-keys.ts';
import {
  type GeneratedPersonalRecord,
  generatedPersonalRecords,
} from './generated-personal-records.ts';
import { inputFingerprint } from './input-fingerprint.ts';
import { keyedInputFingerprint } from './keyed-input-fingerprint.ts';
import type { PersonalMember } from './personal-member.ts';
import { personalMembersOf } from './personal-members-of.ts';
import { replaceAt } from './replace-at.ts';

/**
 * The input with each personal member that names its subject replaced by its digest under the data
 * key of the subject (`digestPersonalMembers`): the members of the input itself and, for a
 * generated `update` or `set`, those of the entity's records inside it. Any member outside a
 * tenant unit stays as it is (the outer digest is keyed for it).
 */
async function digestedInput(
  source: FingerprintSource,
  keys: FingerprintKeys,
  members: readonly PersonalMember[],
  generated: readonly GeneratedPersonalRecord[],
): Promise<unknown> {
  const { action, input } = source;
  if (keys.unit.scope.level !== 'tenant' || typeof input !== 'object' || input === null) {
    return source.input;
  }
  const dataKeys = new Map<string, DataKey>();
  const record = input as Readonly<Record<string, unknown>>;
  let digested: unknown = await digestPersonalMembers(
    { source, keys, dataKeys },
    { record, lookup: record, fields: actionInputFields(action) ?? {}, members },
  );
  for (const item of generated) {
    // A subject that is a path through references is not followed inside a generated write.
    const replaced = await digestPersonalMembers(
      { source, keys, dataKeys },
      {
        record: item.record,
        lookup: item.lookup,
        fields: {},
        members: item.members,
        unvalidated: true,
      },
    );
    digested = replaceAt(digested, item.path, replaced);
  }
  return digested;
}

/** What the fingerprint of one command depends on. */
export interface FingerprintSource {
  readonly registry: Registry;
  readonly action: ActionEntry;
  readonly keys: KeyService;
  /**
   * The key of the keyed digest when the caller derived it before its unit opened; else it is
   * derived from `keys`.
   */
  readonly fingerprintKey?: Uint8Array;
  readonly scope: Scope;
  readonly apiVersion: string;
  /** Set for the job of a reaction: its fingerprint holds no version (see `commandFingerprint`). */
  readonly job?: { readonly reaction?: true; readonly hook?: true };
  readonly input: unknown;
  /** The client's own input, when `input` holds values sealed on the way in. */
  readonly fingerprintInput?: unknown;
}

/**
 * The input fingerprint of a command (section 15.1.7): the plain sha256 of the canonical input, or
 * a keyed digest when the input carries sealed or secret members (S-111) or a personal member
 * (WP-130), also one that a generated `update` or `set` carries in its entity's records. The
 * version argument is the empty text for a reaction's job, which runs at the head of the build that
 * runs it: a copy of the job that runs after a deploy moved the head replays its
 * receipt instead of meeting `core.idempotency_mismatch`. This is a stored format.
 *
 * `keys` is where the personal members are digested, the unit the fingerprint is computed in:
 * each personal member that names its subject is replaced in the hashed input by its digest under
 * the subject's key (`personalMemberDigest`), and the outer digest is the keyed one whenever the
 * input holds a personal member. `null` answers the 0.1.0 form, in which personal members are
 * hashed as they are: a receipt written before the change holds it.
 */
export async function commandFingerprint(
  source: FingerprintSource,
  keys: FingerprintKeys | null,
): Promise<string> {
  const version =
    source.job?.reaction === true || source.job?.hook === true ? '' : source.apiVersion;
  const personal = keys !== null && source.fingerprintInput === undefined;
  const members = personal ? personalMembersOf(source) : [];
  const generated = personal ? generatedPersonalRecords(source) : [];
  if (!carriesSecrets(source) && members.length === 0 && generated.length === 0) {
    return inputFingerprint(source.action.ref, version, source.fingerprintInput ?? source.input);
  }
  const hashed =
    keys === null || (members.length === 0 && generated.length === 0)
      ? (source.fingerprintInput ?? source.input)
      : await digestedInput(source, keys, members, generated);
  const key =
    source.fingerprintKey ?? (await source.keys.derive(source.scope, fingerprintKeyInfo, 32));
  return keyedInputFingerprint(key, source.action.ref, version, hashed);
}
