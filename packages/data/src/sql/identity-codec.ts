import type { ValueCodec } from './value-codec.ts';

/** Passes values through unchanged. */
export const identityCodec: Pick<ValueCodec, 'encode' | 'decode'> = {
  encode: (value) => value,
  decode: (value) => value,
};
