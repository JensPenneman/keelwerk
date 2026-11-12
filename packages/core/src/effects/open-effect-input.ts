import { isKweEnvelope } from '../encryption/is-kwe-envelope.ts';
import type { AnyField } from '../fields/field-def.ts';
import { openKwe } from '../keys/open-kwe.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { effectDataSubject } from './effect-data-subject.ts';
import { secretMembersAsRefs } from './secret-members-as-refs.ts';

const decoder = new TextDecoder();

/**
 * The stored input of an effect opened for its executor (7.9.5, S-127), inside a unit: each personal
 * `$kwe` member opened with `unit.keys.keyById(k)` and the binding of its sealing, then
 * `JSON.parse` (a member of any other field passes through unchanged); secret members as references (`secretMembersAsRefs(entry.input, entry.module, ...)`). The answer is in
 * event form (`beginEffectAttempt` decodes it for the executor). A member whose key is shredded or whose binding differs is
 * left out and named in `erased` (14.7.9.8: a shredded or moved value reads as absent).
 */
export async function openEffectInput(
  unit: Unit,
  entry: EffectEntry,
  effectId: string,
  stored: Readonly<Record<string, unknown>>,
): Promise<{
  readonly input: Readonly<Record<string, unknown>>;
  readonly erased: readonly string[];
}> {
  const { fields } = entry.input as { readonly fields?: Readonly<Record<string, AnyField>> };
  const opened: Record<string, unknown> = {};
  const erased: string[] = [];
  for (const [name, value] of Object.entries(stored)) {
    const field = fields !== undefined && Object.hasOwn(fields, name) ? fields[name] : undefined;
    const sealed = field !== undefined && effectDataSubject(entry, field) !== undefined;
    if (!sealed || !isKweEnvelope(value)) {
      opened[name] = value;
      continue;
    }
    const key = await unit.keys.keyById(value.k);
    const plain = openKwe(value, key?.material, {
      namespace: unit.namespace.id,
      streamId: effectId,
      eventId: effectId,
      field: `input.${name}`,
    });
    if (plain === undefined) erased.push(name);
    else opened[name] = JSON.parse(decoder.decode(plain));
  }
  return { input: secretMembersAsRefs(entry.input, entry.module, opened), erased };
}
