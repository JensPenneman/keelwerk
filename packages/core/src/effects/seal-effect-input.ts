import type { AnyField } from '../fields/field-def.ts';
import type { RandomSource } from '../keys/random-source.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import { effectDataSubject } from './effect-data-subject.ts';
import { personalMemberSealer } from './personal-member-sealer.ts';
import { sealMembers } from './seal-members.ts';
import { sealSecretMembers } from './seal-secret-members.ts';

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
 * compose), `validation` when the path resolves to nothing, `forbidden` when the subject was erased
 * and `internal` outside a tenant unit (`personalMemberSealer`).
 */
export async function sealEffectInput(input: SealEffectInputInput): Promise<unknown> {
  const { unit, entry, effectId } = input;
  const withSecrets = await sealSecretMembers(
    unit,
    {
      site: 'effectInput',
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
  if (fields === undefined) return withSecrets;
  return sealMembers(
    entry.input,
    withSecrets,
    personalMemberSealer({
      unit,
      registry: input.registry,
      module: entry.module,
      owner: { label: `the effect "${entry.ref}"`, ref: entry.ref },
      fields,
      input: input.input,
      id: effectId,
      ...(input.random === undefined ? {} : { random: input.random }),
      encode: encodeEventValue,
      onSubject: (subject) => unit.keys.addRefs(subject, [{ type: 'core.effect', id: effectId }]),
      pathOf: (_name, field) => effectDataSubject(entry, field),
    }),
  );
}
