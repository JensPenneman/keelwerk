import { isKweEnvelope } from '../encryption/is-kwe-envelope.ts';
import { configSecrets } from '../keys/config-secrets.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';

/**
 * Whether a stored value is, or inside a list holds, a sealed value: a `$kwe` envelope of a personal
 * value, the text of a sealed or configuration secret, or a reference to a sealed secret. A member's flags can
 * change between builds, so a record may hold sealed values under a name the current input
 * declares plain; such a value never leaves the kernel as a plain member.
 */
export function holdsSealedValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return parseSealedValueText(value) !== undefined || configSecrets.isText(value);
  }
  if (Array.isArray(value)) return value.some(holdsSealedValue);
  if (typeof value !== 'object' || value === null) return false;
  if (isKweEnvelope(value)) return true;
  const ref: unknown = Reflect.get(value, 'ref');
  return typeof ref === 'string' && holdsSealedValue(ref);
}
