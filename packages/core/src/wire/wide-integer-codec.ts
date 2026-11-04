const int64Min = -(2n ** 63n);
const int64Max = 2n ** 63n - 1n;
const integerText = /^-?[0-9]+$/;

function wideIntegerToWire(value: bigint): string {
  if (value < int64Min || value > int64Max) {
    throw new RangeError('a wide integer is outside the 64-bit range');
  }
  return value.toString();
}

function wideIntegerFromWire(text: string): bigint | undefined {
  if (!integerText.test(text)) {
    return undefined;
  }
  const value = BigInt(text);
  return value < int64Min || value > int64Max ? undefined : value;
}

/** The codec of wide `integer` fields: a decimal string on the wire, within 64 bits (section 6.4). */
export const wideIntegerCodec: {
  /** Throws a `RangeError` outside 64 bits. */
  toWire(value: bigint): string;
  /** The `bigint` of a decimal integer string within 64 bits, or `undefined`. */
  fromWire(text: string): bigint | undefined;
} = { toWire: wideIntegerToWire, fromWire: wideIntegerFromWire };
