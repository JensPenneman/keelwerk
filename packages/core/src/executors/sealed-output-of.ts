import { sealEffectOutput } from '../effects/seal-effect-output.ts';
import { coreError } from '../http/core-error.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import type { Unit } from '../storage/unit.ts';

/** The largest output an effect record keeps: 64 KiB of canonical JSON; blob references arrive with M4. */
const maxOutputBytes = 65_536;
const encoder = new TextEncoder();

/**
 * The output as the settled record keeps it: sealed under the effect's binding and measured. It
 * runs in a nested unit, so an output that is refused (over 64 KiB is `core.effect_output_too_large`)
 * leaves no value key behind.
 */
export function sealedOutputOf(
  unit: Unit,
  entry: EffectEntry,
  effectId: string,
  output: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  return unit.nested(async (nested) => {
    const value = await sealEffectOutput(nested, entry, effectId, output);
    if (encoder.encode(canonicalizeJson(value)).length > maxOutputBytes) {
      throw coreError('core.effect_output_too_large');
    }
    return value;
  });
}
