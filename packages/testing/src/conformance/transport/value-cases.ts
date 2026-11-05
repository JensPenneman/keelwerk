import { expect, test } from 'vitest';
import { dueAt } from './due-at.ts';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { loansOf } from './loans-of.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

const loanId = /^loan_[0-9a-z]{26}$/;
const bookId = /^book_[0-9a-z]{26}$/;

/** Values: a command's output, a query's rows, instants, ids, the version header. */
export function valueCases(target: TransportTarget): void {
  test('a command answers its output', async () => {
    const sent = await sendCall(target, lendCall(freshName('ada'), freshName('Dune')));
    expect(sent.decoded).toEqual({
      ok: true,
      value: { loanId: expect.stringMatching(loanId) },
      accepted: false,
    });
    expect(sent.response.status).toBe(200);
    expect(sent.response.headers.get('keelwerk-version')).toBe('2026-11-04');
    expect(sent.response.headers.get('keelwerk-command-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('a query answers the rows the command wrote, with instants in one form', async () => {
    const subject = freshName('ada');
    const title = freshName('Emma');
    await sendCall(target, lendCall(subject, title));
    expect(await loansOf(target, subject)).toEqual([
      { borrower: subject, bookTitle: title, state: 'open', dueAt: '2026-12-01T00:00:00.000Z' },
    ]);
  });

  test('a query by key answers the id the command returned', async () => {
    const isbn = freshName('isbn');
    const added = await sendCall(target, {
      action: 'library.addBook',
      input: { title: 'Ulysses', isbn },
      caller: { subject: freshName('ada') },
    });
    expect(added.decoded).toEqual({
      ok: true,
      value: { bookId: expect.stringMatching(bookId) },
      accepted: false,
    });
    const found = await sendCall(target, {
      action: 'library.findByIsbn',
      input: { isbn },
      caller: { subject: freshName('ada') },
    });
    expect(found.decoded).toEqual({
      ok: true,
      value: {
        bookId: added.decoded.ok ? (added.decoded.value as { bookId: string }).bookId : '',
        title: 'Ulysses',
      },
      accepted: false,
    });
  });

  test('the same subject sees nothing of another tenant', async () => {
    const subject = freshName('ada');
    await sendCall(
      target,
      lendCall(subject, freshName('Hamlet'), { caller: { subject, tenant: 'acme' } }),
    );
    expect(await loansOf(target, subject, {}, 'globex')).toEqual([]);
    expect(await loansOf(target, subject, {}, 'acme')).toHaveLength(1);
  });

  test('a due date as an instant with an offset is stored as the same instant', async () => {
    const subject = freshName('ada');
    await sendCall(target, {
      action: 'loans.lend',
      input: { bookTitle: freshName('Odyssey'), dueAt: '2026-12-01T02:00:00+02:00' },
      caller: { subject },
    });
    const [row] = await loansOf(target, subject);
    expect(row?.dueAt).toBe(new Date(dueAt).toISOString());
  });
}
