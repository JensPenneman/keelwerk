import { encodeAad } from './encode-aad.ts';

/** The binding of a chain value: `namespace ‖ stream id ‖ event id ‖ field` (14.7.4). */
export interface KweBinding {
  readonly namespace: string;
  readonly streamId: string;
  readonly eventId: string;
  readonly field: string;
}

/**
 * The associated data of a chain value; version 2 appends the part `kwe2`, so a changed version
 * does not open.
 */
export function kweAad(binding: KweBinding, version: 1 | 2 = 1): Uint8Array {
  const parts = [binding.namespace, binding.streamId, binding.eventId, binding.field];
  return encodeAad(version === 2 ? [...parts, 'kwe2'] : parts);
}
