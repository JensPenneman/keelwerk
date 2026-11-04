/**
 * The small value domains of `conf.probe` that rows are drawn from and conditions compare with,
 * chosen to hit the edges of 14.3.4: LIKE metacharacters, the empty string, combining marks,
 * characters beyond the Basic Multilingual Plane (whose code point order differs from the UTF-16
 * order), decimals compared by numeric value, and instants at millisecond precision.
 */
export const conformanceValues: Readonly<Record<string, readonly unknown[]>> = {
  label: [
    '',
    'a',
    'ab',
    'abc',
    'B',
    'b',
    '%',
    '_',
    '\\',
    'a%b',
    'é',
    'é',
    '～',
    '\u{1f600}',
    '\u{10000}',
    'z',
  ],
  note: ['', 'hello world', 'Hello', '100%', 'a_b', 'back\\slash', 'x', 'café \u{1f600}'],
  n: [-5, -1, 0, 1, 2, 3, 7, Number.MAX_SAFE_INTEGER],
  price: ['-1.50', '0.00', '0.50', '2.00', '10.25'],
  ratio: [-1.5, 0, 0.5, 2.25, 1e10],
  flag: [true, false],
  at: [
    Temporal.Instant.from('1969-12-31T23:59:59.999Z'),
    Temporal.Instant.from('2026-01-01T00:00:00.000Z'),
    Temporal.Instant.from('2026-01-01T00:00:00.123Z'),
    Temporal.Instant.from('2026-06-15T12:00:00.000Z'),
  ],
  day: [
    Temporal.PlainDate.from('2025-12-31'),
    Temporal.PlainDate.from('2026-01-01'),
    Temporal.PlainDate.from('2026-02-28'),
  ],
  mood: ['calm', 'busy', 'away'],
  tag: ['x', 'y', 'z', '%'],
  score: [1, 2, 3],
  raw: [new Uint8Array([]), new Uint8Array([1, 2]), new Uint8Array([0, 255])],
  needle: ['', 'a', 'ab', 'b', '%', '_', '\\', 'ell', 'é', '\u{1f600}', 'x'],
  rank: [-1, 0, 1, 2, 5],
};
