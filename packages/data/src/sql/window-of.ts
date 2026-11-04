import type { RowQuery } from '@keelwerk/core';
import { malformedQuery } from './malformed-query.ts';
import type { RowWindow } from './row-window.ts';

function wholeNumber(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0)
    throw malformedQuery(`${what} must be a non-negative integer`);
  return value;
}

export function windowOf(page: RowQuery['page'], maxOffset: number): RowWindow {
  if (page === undefined) {
    return {
      limit: undefined,
      offset: 0,
      backwards: false,
      size: undefined,
      after: undefined,
      before: undefined,
      positional: false,
    };
  }
  if ('position' in page) {
    const { position, limit } = page;
    wholeNumber(limit, 'the page limit');
    if (!Number.isInteger(position) || Math.abs(position) > maxOffset) {
      throw malformedQuery(`the position must be an integer within ±${maxOffset}`);
    }
    if (position >= 0) {
      return {
        limit: limit + 1,
        offset: position,
        backwards: false,
        size: limit,
        after: undefined,
        before: undefined,
        positional: true,
      };
    }
    // From the end: the window [N + position, N + position + limit) is, counted from the last row,
    // the rows from -position - limit to -position - 1; the part before the first row is cut off.
    const from = Math.max(0, -position - limit);
    const size = -position - from;
    return {
      limit: size + 1,
      offset: from,
      backwards: true,
      size,
      after: undefined,
      before: undefined,
      positional: true,
    };
  }
  if (page.first !== undefined && page.last !== undefined) {
    throw malformedQuery('a page takes first or last, not both');
  }
  if (page.after !== undefined && page.before !== undefined) {
    throw malformedQuery('a page takes after or before, not both');
  }
  if (page.first !== undefined) {
    if (page.before !== undefined) throw malformedQuery('first pages with after, not before');
    const size = wholeNumber(page.first, 'first');
    return {
      limit: size + 1,
      offset: 0,
      backwards: false,
      size,
      after: page.after,
      before: undefined,
      positional: false,
    };
  }
  if (page.last !== undefined) {
    if (page.after !== undefined) throw malformedQuery('last pages with before, not after');
    const size = wholeNumber(page.last, 'last');
    return {
      limit: size + 1,
      offset: 0,
      backwards: true,
      size,
      after: undefined,
      before: page.before,
      positional: false,
    };
  }
  return {
    limit: undefined,
    offset: 0,
    backwards: page.before !== undefined,
    size: undefined,
    after: page.after,
    before: page.before,
    positional: false,
  };
}
