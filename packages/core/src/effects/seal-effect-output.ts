import { errors } from '../errors/errors.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import { personalInputField } from './personal-input-field.ts';
import { sealSecretMembers } from './seal-secret-members.ts';

/**
 * The output as the `settled` record stores it (7.9.6, S-127): the output with every secret member
 * sealed by `sealSecretMembers` (`{ entity: 'core.effect', id: effectId, prefix: 'output.',
 * refs: 'text' }`, a reference only when the effect's module loaded it), then `encodeEventValue`. Callers pass the answer to `settledEffectDraft`, so
 * `outputDigest` is over this canonical sealed form. Throws `internal` when the output shape
 * declares a personal field (compose refuses it: `personalEffectOutput`).
 */
export async function sealEffectOutput(
  unit: Unit,
  entry: EffectEntry,
  effectId: string,
  output: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const personal = personalInputField(entry.output);
  if (personal !== undefined) {
    throw errors.internal(`the output of ${entry.ref} declares the personal field "${personal}"`);
  }
  // Sealed before encoding: encoding copies the object and drops the stamp of a loaded reference.
  const sealed = await sealSecretMembers(
    unit,
    {
      entity: 'core.effect',
      id: effectId,
      prefix: 'output.',
      refs: 'text',
      owner: { module: entry.module, effect: entry.ref },
    },
    entry.output,
    output,
  );
  return encodeEventValue(sealed) as Readonly<Record<string, unknown>>;
}
