import { openEffectInput } from '../effects/open-effect-input.ts';
import { validateEffectInput } from '../effects/validate-effect-input.ts';
import type { AnyField } from '../fields/field-def.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { ExternalEffect } from '../protocol/external-effect.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';

function holdsSecret(field: AnyField): boolean {
  return field.kind === 'secret' || (field.inner !== null && holdsSecret(field.inner));
}

/** A value as text for a comparison: an absent value and a null alike are the empty text. */
function textOf(value: unknown): string {
  return value === undefined || value === null ? '' : canonicalizeJson(value);
}

/**
 * Whether the effect a re-decided decision requests is the effect its `core.effect` row records
 * (7.9.6): the same type, the same input, and for a deferred effect the same continuation and key.
 * The input is compared in event form against the row's opened input. A secret member is stored as
 * a reference and is compared by presence, as is a personal one when `personalByPresence` is set; a
 * personal member whose subject was erased cannot be opened and is left out. Answers a sentence for the first difference, or `undefined`.
 */
export async function effectRequestDifference(input: {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly effectId: string;
  readonly effect: ExternalEffect;
  readonly row: StorageRow;
  readonly deferred: boolean;
  /** A personal member is compared by presence, like a secret one: the sentence then never tells a guess from the value. */
  readonly personalByPresence?: true;
}): Promise<string | undefined> {
  const { unit, registry, effectId, effect, row } = input;
  const entry = registry.effects.get(effect.type);
  if (entry === undefined)
    return `the effect ${effectId} is of a type this build lacks (${effect.type})`;
  if (row.type !== entry.ref) {
    return `the effect ${effectId} was requested as ${String(row.type)} and is now ${entry.ref}`;
  }
  if (input.deferred) {
    if (textOf(row.continuation) !== textOf(effect.continueWith)) {
      return `the continuation of the effect ${effectId} differs`;
    }
    if (textOf(row.key) !== textOf(effect.key)) return `the key of the effect ${effectId} differs`;
  }
  const wanted = encodeEventValue(
    validateEffectInput(entry.input, effect.input, `the effect "${entry.ref}"`),
  ) as Readonly<Record<string, unknown>>;
  const stored = typeof row.input === 'object' && row.input !== null ? row.input : {};
  const opened = await openEffectInput(
    unit,
    entry,
    effectId,
    stored as Readonly<Record<string, unknown>>,
  );
  const left = new Set([...opened.erased, ...opened.mismatched]);
  const { fields } = entry.input as { readonly fields?: Readonly<Record<string, AnyField>> };
  const names = new Set([...Object.keys(wanted ?? {}), ...Object.keys(opened.input)]);
  for (const name of names) {
    if (left.has(name)) continue;
    const field = fields !== undefined && Object.hasOwn(fields, name) ? fields[name] : undefined;
    const have = opened.input[name];
    const want = wanted?.[name];
    const same =
      field !== undefined &&
      (holdsSecret(field) || (input.personalByPresence === true && field.flags.personal !== false))
        ? (have === undefined || have === null) === (want === undefined || want === null)
        : textOf(have) === textOf(want);
    if (!same) return `the input of the effect ${effectId} differs in "${name}"`;
  }
  return undefined;
}
