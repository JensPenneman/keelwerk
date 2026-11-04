import { expect } from 'vitest';

function show(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, member) => (typeof member === 'bigint' ? `${member}n` : member),
    2,
  );
}

/** Fails with both sides printed in full when they differ, which a deep-equality failure message does not do. */
export function assertSame(label: string, actual: unknown, expected: unknown): void {
  try {
    expect(actual).toEqual(expected);
  } catch {
    expect.fail(`${label}\nexpected: ${show(expected)}\nreceived: ${show(actual)}`);
  }
}
