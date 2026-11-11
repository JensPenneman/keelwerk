import { errors } from '../errors/errors.ts';
import type { AnyField } from '../fields/field-def.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import { defaultRandomSource } from '../keys/default-random-source.ts';
import type { RandomSource } from '../keys/random-source.ts';
import { sealKwe } from '../keys/seal-kwe.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import { referenceTarget } from '../registry/reference-target.ts';
import type { Registry } from '../registry/registry.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { Unit } from '../storage/unit.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import { resolveDataSubjectHops } from '../write-path/resolve-data-subject-hops.ts';
import { effectDataSubject } from './effect-data-subject.ts';
import { sealSecretMembers } from './seal-secret-members.ts';

const encoder = new TextEncoder();

/** The subject a personal member belongs to: `undefined` when the path resolves to nothing. */
async function subjectOf(
  input: SealEffectInputInput,
  fields: Readonly<Record<string, AnyField>>,
  path: string,
): Promise<string | undefined> {
  const [first = '', ...rest] = path.split('.');
  // The validated input: the sealed one holds the new key's text for a secret member.
  const plain = input.input as Readonly<Record<string, unknown>>;
  const value = Object.hasOwn(plain, first) ? plain[first] : undefined;
  if (value === undefined || value === null) return undefined;
  if (rest.length === 0) {
    if (typeof value !== 'string') {
      throw errors.internal(`${input.entry.ref}: the data subject "${path}" is not an id`);
    }
    return value;
  }
  const head = Object.hasOwn(fields, first) ? fields[first] : undefined;
  const target = referenceTarget(head?.ref ?? null, input.entry.module);
  if (target === null || typeof value !== 'string') return undefined;
  return resolveDataSubjectHops(
    {
      unit: input.unit,
      describe: (ref) => input.registry.entities.get(ref)?.descriptor,
    },
    `${target.module}.${target.entity}`,
    value,
    rest,
  );
}

/** What sealing the input of one effect reads. */
export interface SealEffectInputInput {
  readonly unit: Unit;
  /** Describes the entities a dotted `dataSubject` walks through. */
  readonly registry: Registry;
  readonly entry: EffectEntry;
  readonly effectId: string;
  /** The input after `validateEffectInput`. */
  readonly input: unknown;
  /** Default `defaultRandomSource`; the golden test passes a fixed one. */
  readonly random?: RandomSource;
}

/**
 * The input as the `requested` record stores it (7.9.6, S-127): secret members through
 * `sealSecretMembers` (`{ entity: 'core.effect', id: effectId, prefix: '', refs: 'text' }`, M1's form,
 * unchanged); each present personal member sealed whole as a `$kwe` envelope under its subject's
 * data key, and the subject's reference `{ type: 'core.effect', id: effectId }` added once. Throws
 * `core.request_not_allowed` when a personal member has no subject path (a registry built without
 * compose), `validation` when the path resolves to nothing, and `forbidden` when the subject was erased.
 */
export async function sealEffectInput(input: SealEffectInputInput): Promise<unknown> {
  const { unit, entry, effectId } = input;
  const withSecrets = await sealSecretMembers(
    unit,
    {
      entity: 'core.effect',
      id: effectId,
      prefix: '',
      refs: 'text',
      owner: { module: entry.module, effect: entry.ref },
    },
    entry.input,
    input.input,
  );
  const { fields } = entry.input as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined || typeof withSecrets !== 'object' || withSecrets === null) {
    return withSecrets;
  }
  const values = withSecrets as Readonly<Record<string, unknown>>;
  const random = input.random ?? defaultRandomSource;
  const sealed: Record<string, unknown> = { ...values };
  const keys = new Map<string, DataKey>();
  for (const [name, field] of Object.entries(fields)) {
    const path = effectDataSubject(entry, field);
    const original = Object.hasOwn(values, name) ? values[name] : undefined;
    // An absent personal value needs no subject and leaks only its presence.
    if (path === undefined || original === undefined || original === null) continue;
    if (path === null) {
      throw refuseRequest(
        `the effect "${entry.ref}"`,
        `its input declares the personal field "${name}" and names no data subject`,
      );
    }
    const subject = await subjectOf(input, fields, path);
    if (subject === undefined) {
      throw errors.validation(
        `${entry.ref}.${name} is personal and needs its data subject "${path}".`,
        { issues: [{ path: [name], message: `Needs the data subject "${path}".` }] },
      );
    }
    let key = keys.get(subject);
    if (key === undefined) {
      key = await unit.keys.dataKey(subject, { create: true });
      if (key === undefined) {
        throw errors.forbidden('The data subject was erased: personal values cannot be written.');
      }
      keys.set(subject, key);
      await unit.keys.addRefs(subject, [{ type: 'core.effect', id: effectId }]);
    }
    sealed[name] = sealKwe(
      key,
      encoder.encode(JSON.stringify(encodeEventValue(original))),
      {
        namespace: unit.namespace.id,
        streamId: effectId,
        eventId: effectId,
        field: `input.${name}`,
      },
      random,
    );
  }
  return sealed;
}
