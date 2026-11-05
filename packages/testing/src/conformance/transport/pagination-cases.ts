import { expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

interface Page {
  readonly items: readonly { readonly id: string; readonly bookTitle: string }[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor?: string };
}

/** Pagination: cursors page through every row once, in the same order, on both transports. */
export function paginationCases(target: TransportTarget): void {
  test('pages of two cover five rows once and say when there is no next page', async () => {
    const subject = freshName('ada');
    const titles = ['a', 'b', 'c', 'd', 'e'].map((suffix) => `${freshName('book')}-${suffix}`);
    for (const title of titles) {
      expect((await sendCall(target, lendCall(subject, title))).decoded.ok).toBe(true);
    }
    const sizes: number[] = [];
    const flags: boolean[] = [];
    const seen: string[] = [];
    let after: string | undefined;
    for (let round = 0; round < 6; round += 1) {
      const sent = await sendCall(target, {
        action: 'loans.loan.query',
        input: { first: 2, ...(after === undefined ? {} : { after }) },
        caller: { subject },
      });
      expect(sent.decoded.ok).toBe(true);
      const page = (sent.decoded.ok ? sent.decoded.value : undefined) as Page;
      sizes.push(page.items.length);
      flags.push(page.pageInfo.hasNextPage);
      seen.push(...page.items.map((item) => item.bookTitle));
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    expect(sizes).toEqual([2, 2, 1]);
    expect(flags).toEqual([true, true, false]);
    expect(new Set(seen)).toEqual(new Set(titles));
    expect(seen).toHaveLength(5);
  });

  test('a sort by a sortable field gives the same order on both codecs', async () => {
    const subject = freshName('ada');
    for (const suffix of ['c', 'a', 'b']) {
      expect(
        (await sendCall(target, lendCall(subject, `${freshName('book')}-${suffix}`))).decoded.ok,
      ).toBe(true);
    }
    const idsOf = async (direction: 'asc' | 'desc'): Promise<string[]> => {
      const sent = await sendCall(target, {
        action: 'loans.loan.query',
        input: { sort: [{ field: 'id', direction }] },
        caller: { subject },
      });
      expect(sent.decoded.ok).toBe(true);
      const page = (sent.decoded.ok ? sent.decoded.value : undefined) as Page;
      return page.items.map((item) => item.id);
    };
    const ascending = await idsOf('asc');
    expect(ascending).toHaveLength(3);
    expect(ascending).toEqual([...ascending].sort());
    expect(await idsOf('desc')).toEqual([...ascending].reverse());
  });

  test('a cursor that was not issued is a validation error', async () => {
    const sent = await sendCall(target, {
      action: 'loans.loan.query',
      input: { first: 2, after: 'not-a-cursor' },
      caller: { subject: freshName('ada') },
    });
    expect(sent.decoded.ok).toBe(false);
    expect(sent.response.status).toBeGreaterThanOrEqual(400);
    expect(sent.response.status).toBeLessThan(500);
  });
}
