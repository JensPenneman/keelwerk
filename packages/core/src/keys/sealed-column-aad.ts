import { encodeAad } from './encode-aad.ts';

/** The binding of a state column value: `namespace ‖ entity ‖ row id ‖ field ‖ key id` (14.7.9.6). */
export interface SealedColumnBinding {
  readonly namespace: string;
  readonly entity: string;
  readonly rowId: string;
  readonly field: string;
}

/** The associated data of a column value; `keyId` is the 16 key id bytes. */
export function sealedColumnAad(binding: SealedColumnBinding, keyId: Uint8Array): Uint8Array {
  return encodeAad([binding.namespace, binding.entity, binding.rowId, binding.field, keyId]);
}
