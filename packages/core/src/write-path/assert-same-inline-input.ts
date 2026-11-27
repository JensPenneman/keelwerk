import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import { timingSafeEqual } from '../crypto/timing-safe-equal.ts';
import { openEffectInput } from '../effects/open-effect-input.ts';
import type { AnyField } from '../fields/field-def.ts';
import { sealsCredentialAt } from '../fields/seals-credential-at.ts';
import { coreError } from '../http/core-error.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { configSecrets } from '../keys/config-secrets.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { encodeEventValue } from './encode-event-value.ts';

const encoder = new TextEncoder();

/** What one comparison reads: the unit, the effect, and the key that hides secret bytes and their lengths. */
interface Comparison {
  readonly unit: Unit;
  readonly entry: EffectEntry;
  readonly effectId: string;
  readonly key: Uint8Array;
}

const canonical = (value: unknown): string => canonicalizeJson(encodeEventValue(value) ?? null);

/** Two byte strings compared as the HMACs of both under one fresh key, so no length or prefix shows in the time. */
function sameBytes(key: Uint8Array, a: Uint8Array, b: Uint8Array): boolean {
  return timingSafeEqual(hmacSha256(key, a), hmacSha256(key, b));
}

/** The value of a stored secret text under its own effect and member; undefined for a configuration secret, a text that is no sealed value, a destroyed key or another binding. */
async function openStored(
  c: Comparison,
  name: string,
  text: string,
): Promise<Uint8Array | undefined> {
  if (configSecrets.isText(text)) return undefined;
  const parsed = parseSealedValueText(text);
  if (parsed === undefined) return undefined;
  return c.unit.keys.openValue(parsed, { entity: 'core.effect', id: c.effectId, field: name });
}

/** One secret value, given as plain text or as a reference its module loaded, against the stored text. */
async function sameSecretValue(
  c: Comparison,
  name: string,
  stored: unknown,
  given: unknown,
): Promise<boolean> {
  if (typeof stored !== 'string') return false;
  if (typeof given === 'string') {
    if (given === '' || stored === '') return given === stored;
    const plain = await openStored(c, name, stored);
    return plain !== undefined && sameBytes(c.key, plain, encoder.encode(given));
  }
  if (typeof given !== 'object' || given === null) return false;
  const ref: unknown = Reflect.get(given, 'ref');
  // A reference its module did not load is never opened.
  if (typeof ref !== 'string' || Reflect.get(given, secretRefOwner) !== c.entry.module) {
    return false;
  }
  if (configSecrets.isText(ref)) {
    // A configuration secret is stored as its text: nothing is derived or opened here.
    return (
      configSecrets.parse(ref)?.moduleId === c.entry.module &&
      sameBytes(c.key, encoder.encode(stored), encoder.encode(ref))
    );
  }
  const loaded = parseSealedValueText(ref);
  if (loaded === undefined) return false;
  const theirs = await c.unit.keys.openValue(loaded);
  const ours = await openStored(c, name, stored);
  return theirs !== undefined && ours !== undefined && sameBytes(c.key, ours, theirs);
}

/** A member that holds a secret: the stored value (never the opened one) against the given. */
async function sameSecret(
  c: Comparison,
  name: string,
  field: AnyField,
  stored: unknown,
  given: unknown,
): Promise<boolean> {
  if (stored === null || stored === undefined || given === null || given === undefined) {
    return stored === given;
  }
  if (field.kind === 'secret') return sameSecretValue(c, name, stored, given);
  const { inner } = field;
  if (inner !== null && Array.isArray(stored)) {
    const members: unknown[] | undefined = Array.isArray(given)
      ? given
      : given instanceof Set
        ? [...given]
        : undefined;
    if (members === undefined || members.length !== stored.length) return false;
    let same = true;
    // Every element is compared, in stored order: a set in another order is refused.
    for (const [index, member] of stored.entries()) {
      same = (await sameSecret(c, name, inner, member, members[index])) && same;
    }
    return same;
  }
  return canonical(stored) === canonical(given);
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function sameInput(c: Comparison, stored: unknown, given: unknown): Promise<boolean> {
  const { fields } = c.entry.input as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined || !isRecord(stored) || !isRecord(given)) {
    return canonical(stored) === canonical(given);
  }
  const opened = await openEffectInput(c.unit, c.entry, c.effectId, stored);
  if (opened.mismatched.length > 0 || opened.erased.length > 0) return false;
  let same = true;
  for (const name of new Set([...Object.keys(stored), ...Object.keys(given)])) {
    const theirs = given[name];
    const ours = stored[name];
    if ((theirs === undefined) !== (ours === undefined)) return false;
    if (theirs === undefined) continue;
    const field = Object.hasOwn(fields, name) ? fields[name] : undefined;
    // Secrets are compared on the stored text: the opened input holds stamped references to it.
    same =
      (field !== undefined && sealsCredentialAt('effectInput', field, 'secret')
        ? await sameSecret(c, name, field, ours, theirs)
        : canonical(opened.input[name]) === canonical(theirs)) && same;
  }
  return same;
}

/**
 * The input of an inline effect that has a row, against the input of the run that asks (7.9.5): the
 * same members in event form (`canonicalizeJson` of `encodeEventValue` of both), personal members
 * opened inside the unit, secret members compared on their stored text, never opened for anyone
 * else's reference: a plain given value is compared with the stored value opened under its own
 * effect and member; a reference its module loaded is opened and compared; a configuration secret is
 * compared as text. Every comparison of secret bytes is the comparison of two HMACs under a key
 * drawn for this call, so no length shows either, and no plain value is logged, returned or written.
 * Any difference, a personal member that was erased or does not open, or a secret that cannot be
 * opened is `core.idempotency_mismatch`, so no outcome reaches a request that is not the same.
 */
export async function assertSameInlineInput(
  unit: Unit,
  entry: EffectEntry,
  effectId: string,
  stored: unknown,
  given: unknown,
): Promise<void> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  if (!(await sameInput({ unit, entry, effectId, key }, stored, given))) {
    throw coreError('core.idempotency_mismatch', {
      message: 'The command id was used with a different request.',
    });
  }
}
