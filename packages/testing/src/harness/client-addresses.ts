/**
 * A source of client addresses for in-process requests: 198.18.0.1, 198.18.0.2, ... through
 * 198.19.255.254 (198.18.0.0/15, set aside for tests by RFC 2544), one new address per call.
 * Throws a RangeError once the range is spent.
 */
export function clientAddresses(): () => string {
  const last = 131_070;
  let n = 0;
  return () => {
    if (n >= last) {
      throw new RangeError('The test client addresses 198.18.0.1 to 198.19.255.254 are spent.');
    }
    n += 1;
    return `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`;
  };
}
