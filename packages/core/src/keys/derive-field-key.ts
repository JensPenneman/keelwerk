import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { deriveHkdf } from './derive-hkdf.ts';
import { encodeAad } from './encode-aad.ts';

const salt = 'keelwerk/index/1';

/** What names one index field key (14.7.9.7). */
export interface FieldKeyInput {
  readonly entity: string;
  readonly field: string;
  /** `eq`, `prefix`, `contains`, `search` or `order`: each capability has its own key. */
  readonly capability: string;
  /** The normaliser id and version, such as `email@1`. */
  readonly normaliser: string;
  /** The capability's parameters; absent means none. Serialised as canonical JSON. */
  readonly parameters?: unknown;
}

/**
 * The key of one capability of one field: HKDF-SHA-256 over the tenant's index root key with salt
 * `keelwerk/index/1` and info `entity ‖ field ‖ capability ‖ normaliser ‖ parameters`, the parts
 * length-prefixed (`encodeAad`) and the parameters as canonical JSON. The keys of two capabilities
 * of one value cannot be linked.
 */
export function deriveFieldKey(root: Uint8Array, input: FieldKeyInput): Uint8Array {
  const info = encodeAad([
    input.entity,
    input.field,
    input.capability,
    input.normaliser,
    canonicalizeJson(input.parameters ?? null),
  ]);
  return deriveHkdf(root, salt, info, 32);
}
