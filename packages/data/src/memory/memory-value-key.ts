const decimalText = /^([+-]?)(\d*)(?:\.(\d*))?$/;

function decimalKey(text: string): string {
  const match = decimalText.exec(text);
  if (match === null) return `s:${text}`;
  const integer = (match[2] ?? '').replace(/^0+/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  if (integer === '' && fraction === '') return 'd:0';
  return `d:${match[1] === '-' ? '-' : ''}${integer === '' ? '0' : integer}${fraction === '' ? '' : `.${fraction}`}`;
}

/**
 * A string that is equal for two values exactly when the database would call them equal: the
 * key of a unique tuple or of a serial partition. Integers match across `number` and `bigint`,
 * decimals by numeric value, sets without order.
 */
export function memoryValueKey(value: unknown, decimal = false): string {
  if (value === null || value === undefined) return 'n';
  switch (typeof value) {
    case 'string':
      return decimal ? decimalKey(value) : `s:${value}`;
    case 'number':
      return Number.isInteger(value) ? `i:${value}` : `f:${value}`;
    case 'bigint':
      return `i:${value}`;
    case 'boolean':
      return `b:${value}`;
    default:
      break;
  }
  if (value instanceof Uint8Array) return `x:${Buffer.from(value).toString('hex')}`;
  if (value instanceof Temporal.Instant || value instanceof Temporal.PlainDate) {
    return `t:${value.toString()}`;
  }
  if (value instanceof Date) return `t:${value.toISOString()}`;
  if (value instanceof Set)
    return `{${[...value]
      .map((member) => memoryValueKey(member))
      .sort()
      .join(',')}}`;
  if (Array.isArray(value)) return `[${value.map((member) => memoryValueKey(member)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, member]) => `${JSON.stringify(name)}:${memoryValueKey(member)}`);
    return `o{${entries.join(',')}}`;
  }
  return `?:${String(value)}`;
}
