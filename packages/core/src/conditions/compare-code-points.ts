/** Orders two strings by Unicode code point, not by UTF-16 unit (section 14.3.4): -1, 0 or 1. */
export function compareCodePoints(a: string, b: string): -1 | 0 | 1 {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a.codePointAt(i) ?? 0;
    const right = b.codePointAt(j) ?? 0;
    if (left !== right) return left < right ? -1 : 1;
    i += left > 0xffff ? 2 : 1;
    j += right > 0xffff ? 2 : 1;
  }
  const leftRest = a.length - i;
  const rightRest = b.length - j;
  if (leftRest === rightRest) return 0;
  return leftRest < rightRest ? -1 : 1;
}
