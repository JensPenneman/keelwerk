import type { SecretRef } from '../ids/secret-ref.ts';
import type { SealedValue } from '../storage/sealed-value.ts';
import { parseSealedValueText } from './parse-sealed-value-text.ts';

/** The sealed value a reference names; `undefined` when the text is no reference. */
export function parseSealedValueRef(ref: SecretRef): SealedValue | undefined {
  return parseSealedValueText(ref.ref);
}
