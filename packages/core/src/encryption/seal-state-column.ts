import type { RandomSource } from '../keys/random-source.ts';
import { sealColumn } from '../keys/seal-column.ts';
import type { SealedColumnBinding } from '../keys/sealed-column-aad.ts';
import type { DataKey } from '../storage/data-key.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';

const encoder = new TextEncoder();

/**
 * The bytes of a personal state column (14.7.9.6): the value in its event form as JSON, padded and
 * sealed under the subject's data key with `namespace ‖ entity ‖ row id ‖ field ‖ key id` as
 * associated data. State sealing is independent of the chain, so compaction can rewrite events.
 */
export function sealStateColumn(
  key: DataKey,
  value: unknown,
  binding: SealedColumnBinding,
  random: RandomSource,
): Uint8Array {
  return sealColumn(key, encoder.encode(JSON.stringify(encodeEventValue(value))), binding, random);
}
