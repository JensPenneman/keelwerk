import { errors } from '../errors/errors.ts';
import { createValueKeyLifecycle } from '../keys/create-value-key-lifecycle.ts';
import { nestedCredentialField } from '../keys/nested-credential-field.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import { payloadCredentialField } from '../keys/payload-credential-field.ts';
import { sealedFieldsOf } from '../keys/sealed-fields-of.ts';
import { sealedValueText } from '../keys/sealed-value-text.ts';
import type { AnyDraft } from '../protocol/any-draft.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { Unit } from '../storage/unit.ts';

const encoder = new TextEncoder();

async function sealText(
  unit: Unit,
  entry: EntityEntry,
  id: string,
  field: string,
  value: string,
): Promise<string> {
  const seal = await unit.keys.sealValue({ entity: entry.ref, id, field }, encoder.encode(value));
  return sealedValueText(seal);
}

/** The text of a reference value (`{ ref }`) a part carried over from a loaded row, if it is one. */
function referenceOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const ref: unknown = Reflect.get(value, 'ref');
  return typeof ref === 'string' && parseSealedValueText(ref) !== undefined ? ref : undefined;
}

function refuse(entry: EntityEntry, name: string, why: string): Error {
  return errors.validation(`${entry.ref}.${name} ${why}`, {
    issues: [{ path: [name], message: why }],
  });
}

/** What sealing credential material reads. */
export interface SealDraftsInput {
  readonly registry: Registry;
  readonly unit: Unit;
  readonly drafts: readonly AnyDraft[];
  /** Receives the sealed text of each plain verifier value, keyed by the value (first seal wins). */
  readonly sealedVerifiers?: Map<string, string>;
}

/**
 * Seals the credential material of the drafts with fresh value keys (section 15.1.6, step 6): each
 * value of a `field.secret()` or `field.verifier()` field is sealed under its own value key with
 * the entity, row id and field as associated data, and the draft carries the sealed text
 * `kwv1.<key id>.<nonce>.<ciphertext>` from here on, so events and state hold no plaintext. The
 * key of a value that is replaced or cleared, and of every credential value of an archived row, is
 * destroyed in the same unit. A reference taken from the row's own current value (`{ ref }`, or a
 * verifier's stored text) is kept as it is; any other reference is refused, and a plain string of
 * a secret field is always a value to seal. Credentials the kernel does not seal per value (a
 * list or set of secrets, a secret in an event payload) are refused instead of stored in plaintext.
 */
export async function sealDrafts(input: SealDraftsInput): Promise<readonly AnyDraft[]> {
  const { registry, unit } = input;
  const lifecycle = createValueKeyLifecycle(unit);
  const sealed: AnyDraft[] = [];
  for (const draft of input.drafts) {
    const entry = registry.entities.get(draft.entity);
    if (entry !== undefined && draft.kind === 'event') {
      const inPayload = payloadCredentialField(entry.events[draft.type]);
      if (inPayload !== undefined) {
        throw refuse(
          entry,
          inPayload,
          'is a credential in an event payload, which is not sealed; keep it in an entity field.',
        );
      }
    }
    if (entry !== undefined && (draft.kind === 'create' || draft.kind === 'update')) {
      const written: Record<string, FieldDescriptor> = {};
      for (const name of Object.keys(draft.values)) {
        const field = entry.descriptor.fields[name];
        if (field !== undefined) written[name] = field;
      }
      const nested = nestedCredentialField(written);
      if (nested !== undefined) {
        throw refuse(
          entry,
          nested,
          'holds credentials in a list or set, which are not sealed per value; use one secret field per value.',
        );
      }
    }
    const fields = entry === undefined ? [] : sealedFieldsOf(entry);
    if (entry === undefined || fields.length === 0 || draft.kind === 'event') {
      sealed.push(draft);
      continue;
    }
    const fresh = draft.kind === 'create';
    if (draft.kind === 'archive') {
      for (const name of fields) {
        const keyId = await lifecycle.keyOf(entry, draft.id, name, false);
        if (keyId === undefined) continue;
        await lifecycle.destroy(keyId);
        lifecycle.sealed(entry, draft.id, name, undefined);
      }
      sealed.push(draft);
      continue;
    }
    if (draft.kind === 'restore') {
      sealed.push(draft);
      continue;
    }
    const values: Record<string, unknown> = { ...draft.values };
    for (const name of fields) {
      if (!Object.hasOwn(values, name)) continue;
      const value = values[name];
      if (value === undefined) continue;
      const former = await lifecycle.keyOf(entry, draft.id, name, fresh);
      let text: string | undefined;
      if (value === null) {
        text = undefined;
      } else if (typeof value === 'string' && entry.descriptor.fields[name]?.kind === 'verifier') {
        // A loaded verifier written back is its stored text: kept only when it is this row's own.
        if (value === '') throw refuse(entry, name, 'must not be empty.');
        if (parseSealedValueText(value) !== undefined) {
          if (former === undefined || parseSealedValueText(value)?.keyId !== former) {
            throw refuse(
              entry,
              name,
              "takes a plain value to seal, not another value's reference.",
            );
          }
          text = value;
        } else {
          text = await sealText(unit, entry, draft.id, name, value);
          if (input.sealedVerifiers?.has(value) === false) input.sealedVerifiers.set(value, text);
        }
      } else if (typeof value === 'string') {
        if (value === '') throw refuse(entry, name, 'must not be empty.');
        text = await sealText(unit, entry, draft.id, name, value);
      } else {
        text = referenceOf(value);
        if (text === undefined) throw refuse(entry, name, 'takes a plain value to seal.');
        if (former === undefined || parseSealedValueText(text)?.keyId !== former) {
          throw refuse(entry, name, "takes a plain value to seal, not another value's reference.");
        }
      }
      const keyId = text === undefined ? undefined : parseSealedValueText(text)?.keyId;
      if (former !== undefined && former !== keyId) await lifecycle.destroy(former);
      lifecycle.sealed(entry, draft.id, name, keyId);
      if (text === undefined) values[name] = null;
      else values[name] = text;
    }
    sealed.push(Object.freeze({ ...draft, values: Object.freeze(values) }) as AnyDraft);
  }
  return sealed;
}
