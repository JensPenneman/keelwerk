import { uuidOf } from './graphql-kit.ts';

const at = Temporal.Instant.from('2026-11-01T10:00:00Z');

/** The n-th loan as the invoker answers it: in-process values. */
export function loanRow(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuidOf(n),
    version: 1,
    borrower: 'ada',
    bookTitle: `Title ${n}`,
    state: 'open',
    dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

/** The n-th book as the invoker answers it. */
export function libraryBookRow(
  n: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: uuidOf(n),
    version: 1,
    title: `Book ${n}`,
    isbn: `isbn-${n}`,
    addedBy: 'ada',
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

export function rowPage(
  items: readonly Record<string, unknown>[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return { items, pageInfo: { hasNextPage: false, hasPreviousPage: false }, ...over };
}
