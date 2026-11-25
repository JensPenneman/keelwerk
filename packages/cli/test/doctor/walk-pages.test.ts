import { describe, expect, test } from 'vitest';
import { doctorReadBounds } from '../../src/doctor/doctor-read-bounds.ts';
import { walkPages } from '../../src/doctor/walk-pages.ts';

const { pageBudget, pageSize } = doctorReadBounds;

/** A read that answers that a page follows until it has been read `pages` times. */
function pagesOf(pages: number) {
  const state = { reads: 0 };
  return {
    state,
    readPage: async () => {
      state.reads += 1;
      return state.reads < pages;
    },
  };
}

describe('the walk over the pages of a read', () => {
  test('ends at the page that says none follows', async () => {
    const { state, readPage } = pagesOf(3);
    await walkPages(readPage);
    expect(state.reads).toBe(3);
  });

  test('a read that has pages left after the budget throws, after exactly the budget of pages', async () => {
    const { state, readPage } = pagesOf(pageBudget + 5);
    await expect(walkPages(readPage)).rejects.toThrow(`more than ${pageBudget * pageSize} rows`);
    expect(state.reads).toBe(pageBudget);
  });

  test('a read whose last page is the last the budget allows is complete', async () => {
    const { state, readPage } = pagesOf(pageBudget);
    await walkPages(readPage);
    expect(state.reads).toBe(pageBudget);
  });
});
