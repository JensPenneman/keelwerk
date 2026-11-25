import { doctorReadBounds } from './doctor-read-bounds.ts';

/**
 * Runs `readPage` until it answers that no page follows. A read that still has a page after the
 * budget of pages throws, so that the fact it reads is absent and never a partial list.
 */
export async function walkPages(readPage: () => Promise<boolean>): Promise<void> {
  const { pageBudget, pageSize } = doctorReadBounds;
  for (let page = 0; page < pageBudget; page += 1) {
    if (!(await readPage())) return;
  }
  throw new Error(`more than ${pageBudget * pageSize} rows`);
}
