import type { DialectCodecs, ValueCodec } from '../sql/value-codec.ts';

const passthrough: ValueCodec = {
  encode: (value) => value,
  decode: (value) => value,
  sqlType: '',
  readAsText: false,
};

/** The sort compiler asks a dialect for codecs; the in-memory store keeps domain values, so it has none to apply. */
export const memoryCodecs: DialectCodecs = {
  forField: () => passthrough,
  forDerivedIndex: () => passthrough,
};
