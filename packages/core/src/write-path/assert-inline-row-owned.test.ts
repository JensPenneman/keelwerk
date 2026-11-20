import { expect, test } from 'vitest';
import { assertInlineRowOwned } from './assert-inline-row-owned.ts';

const t0 = Temporal.Instant.from('2026-11-19T10:00:00Z');
const windowMs = 60_000;
const afterWindow = t0.add({ milliseconds: windowMs });
const own = { resolver: 'test.principal', principalId: 'ada' };

const row = (over: Record<string, unknown> = {}) => ({
  type: 'app.ping',
  commandId: 'c-1',
  principalResolver: null,
  principalId: null,
  createdAt: t0,
  ...over,
});

const expected = (over: Record<string, unknown> = {}) => ({
  type: 'app.ping',
  commandId: 'c-1',
  submitter: undefined,
  now: afterWindow,
  windowMs,
  ...over,
});

const messageOf = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return 'answered';
};

const different = 'The command id was used with a different request.';

test('a row inside its window answers the same principal reference', () => {
  expect(messageOf(() => assertInlineRowOwned(row(), expected({ now: t0 })))).toBe('answered');
  expect(
    messageOf(() =>
      assertInlineRowOwned(
        row({ principalResolver: own.resolver, principalId: own.principalId }),
        expected({ now: t0, submitter: own }),
      ),
    ),
  ).toBe('answered');
});

test('past the window a row with no submitter says what any other refusal says', () => {
  expect(messageOf(() => assertInlineRowOwned(row(), expected()))).toBe(different);
  expect(
    messageOf(() =>
      assertInlineRowOwned(
        row({ principalResolver: 'test.principal', principalId: 'bea' }),
        expected(),
      ),
    ),
  ).toBe(different);
});

test("a named caller's own row past the window says that its window has ended", () => {
  expect(
    messageOf(() =>
      assertInlineRowOwned(
        row({ principalResolver: own.resolver, principalId: own.principalId }),
        expected({ submitter: own }),
      ),
    ),
  ).toBe('The command id was used before, and the window of its receipt has ended.');
});
