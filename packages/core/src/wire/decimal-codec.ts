const decimalText = /^(-?)(\d+)(?:\.(\d+))?$/;

function decimalFromWire(text: string): string | undefined {
  const match = decimalText.exec(text);
  if (match === null) {
    return undefined;
  }
  const whole = (match[2] ?? '0').replace(/^0+(?=\d)/, '');
  const fraction = match[3];
  const digits = fraction === undefined ? whole : `${whole}.${fraction}`;
  return match[1] === '-' && /[1-9]/.test(digits) ? `-${digits}` : digits;
}

function decimalToWire(value: string): string {
  const text = decimalFromWire(value);
  if (text === undefined) {
    throw new TypeError(`'${value}' is not a decimal string`);
  }
  return text;
}

/**
 * The codec of `decimal` fields: the canonical decimal string, with no leading zeros in the
 * integer part and no sign on zero, every fraction digit kept so the scale a validated value was
 * padded to survives.
 */
export const decimalCodec: {
  /** Throws a `TypeError` for text that is not a decimal. */
  toWire(value: string): string;
  /** The canonical form, or `undefined` when the text is not a decimal. */
  fromWire(text: string): string | undefined;
} = { toWire: decimalToWire, fromWire: decimalFromWire };
