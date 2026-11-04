import { encodeAad } from './encode-aad.ts';

/** The binding of a chain value: `namespace ‖ stream id ‖ event id ‖ field` (14.7.4). */
export interface KweBinding {
  readonly namespace: string;
  readonly streamId: string;
  readonly eventId: string;
  readonly field: string;
}

/** The associated data of a chain value. */
export function kweAad(binding: KweBinding): Uint8Array {
  return encodeAad([binding.namespace, binding.streamId, binding.eventId, binding.field]);
}
