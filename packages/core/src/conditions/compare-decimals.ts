const decimalText = /^([+-]?)(\d*)(?:\.(\d*))?$/;

function trimLeadingZeros(text: string): string {
  let start = 0;
  while (start < text.length && text[start] === '0') start += 1;
  return text.slice(start);
}

function trimTrailingZeros(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '0') end -= 1;
  return text.slice(0, end);
}

interface ParsedDecimal {
  readonly sign: -1 | 0 | 1;
  readonly integer: string;
  readonly fraction: string;
}

function parse(text: string): ParsedDecimal | undefined {
  const match = decimalText.exec(text);
  if (match === null) return undefined;
  const integer = trimLeadingZeros(match[2] ?? '');
  const fraction = trimTrailingZeros(match[3] ?? '');
  if ((match[2] ?? '') === '' && (match[3] ?? '') === '') return undefined;
  if (integer === '' && fraction === '') return { sign: 0, integer, fraction };
  return { sign: match[1] === '-' ? -1 : 1, integer, fraction };
}

function compareMagnitude(a: ParsedDecimal, b: ParsedDecimal): number {
  if (a.integer.length !== b.integer.length) return a.integer.length - b.integer.length;
  if (a.integer !== b.integer) return a.integer < b.integer ? -1 : 1;
  if (a.fraction === b.fraction) return 0;
  return a.fraction < b.fraction ? -1 : 1;
}

/**
 * Orders two decimal strings by numeric value, as PostgreSQL `numeric` does: sign first, then the
 * length of the integer part without leading zeros, then the digits, with trailing zeros of the
 * fraction ignored. `undefined` when either text is not a plain decimal.
 */
export function compareDecimals(a: string, b: string): number | undefined {
  const left = parse(a);
  const right = parse(b);
  if (left === undefined || right === undefined) return undefined;
  if (left.sign !== right.sign) return left.sign < right.sign ? -1 : 1;
  if (left.sign === 0) return 0;
  const magnitude = compareMagnitude(left, right);
  return left.sign === 1 ? magnitude : -magnitude;
}
