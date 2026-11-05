import { expect, test } from 'vitest';
import { dueAt } from './due-at.ts';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { loansOf } from './loans-of.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

function itemsOf(value: unknown): readonly Record<string, unknown>[] {
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

async function rowsOf(
  target: TransportTarget,
  subject: string,
  roles: readonly string[],
  bookTitle: string,
): Promise<readonly Record<string, unknown>[]> {
  const sent = await sendCall(target, {
    action: 'loans.loan.query',
    input: { filter: { bookTitle } },
    caller: { subject, roles },
  });
  return sent.decoded.ok ? itemsOf(sent.decoded.value) : [];
}

/**
 * Masks and row rules: the rule of the loan decides which rows a caller reads and whether the
 * maskable `note` is part of them; the transport only carries the result. Field selection limits
 * are written in the streaming cases (S-39).
 */
export function maskCases(target: TransportTarget): void {
  test('a borrower reads her rows and another user reads none of them', async () => {
    const ada = freshName('ada');
    await sendCall(target, lendCall(ada, freshName('Dune')));
    expect(await loansOf(target, ada)).toHaveLength(1);
    expect(await loansOf(target, freshName('bob'))).toEqual([]);
  });

  test('a row never carries a note nobody wrote, and keeps the same keys on both transports', async () => {
    const ada = freshName('ada');
    await sendCall(target, lendCall(ada, freshName('Emma')));
    const sent = await sendCall(target, {
      action: 'loans.loan.query',
      input: {},
      caller: { subject: ada },
    });
    const [row] = sent.decoded.ok ? itemsOf(sent.decoded.value) : [];
    expect(Object.keys(row ?? {}).toSorted()).toEqual([
      'bookTitle',
      'borrower',
      'createdAt',
      'dueAt',
      'id',
      'state',
      'updatedAt',
      'version',
    ]);
  });

  test('the borrower reads the note she wrote; an auditor reads the same row without it', async () => {
    const ada = freshName('ada');
    const title = freshName('Hamlet');
    const lent = await sendCall(
      target,
      lendCall(ada, title, {
        input: { bookTitle: title, dueAt, note: 'Returned with a stain on page 9' },
      }),
    );
    expect(lent.decoded.ok).toBe(true);
    const own = await rowsOf(target, ada, [], title);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ bookTitle: title, note: 'Returned with a stain on page 9' });
    const audited = await rowsOf(target, freshName('auditor'), ['auditor'], title);
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ bookTitle: title, borrower: ada });
    expect(audited[0]).not.toHaveProperty('note');
    expect(audited[0]).toMatchObject({ $masked: ['note'] });
    expect(own[0]).not.toHaveProperty('$masked');
  });

  test('anonymous reads no rows: it is unauthenticated', async () => {
    const sent = await sendCall(target, { action: 'loans.loan.query', input: {} });
    expect(sent.decoded).toEqual({
      ok: false,
      kind: 'unauthenticated',
      code: 'core.unauthenticated',
    });
  });
}
