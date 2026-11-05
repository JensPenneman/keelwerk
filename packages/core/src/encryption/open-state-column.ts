import { openColumn } from '../keys/open-column.ts';
import type { SealedColumnBinding } from '../keys/sealed-column-aad.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { decodeEventValue } from '../write-path/decode-event-value.ts';

const decoder = new TextDecoder();

/** The domain value of a sealed state column; `undefined` when the key is gone or the value does not belong to this row and field. */
export function openStateColumn(
  sealed: Uint8Array,
  key: Uint8Array | undefined,
  field: FieldDescriptor,
  binding: SealedColumnBinding,
): unknown {
  const plain = openColumn(sealed, key, binding);
  if (plain === undefined) return undefined;
  return decodeEventValue(field, JSON.parse(decoder.decode(plain)) as unknown);
}
