import { expect, test } from 'vitest';
import { dueAt } from './due-at.ts';
import { freshName } from './fresh-name.ts';
import { lendCall } from './lend-call.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/** Errors: the taxonomy kind and code come back alike, with the status of 16.4.6 and the request id. */
export function errorCases(target: TransportTarget): void {
  test('invalid input is validation with the path of the field', async () => {
    const sent = await sendCall(target, {
      action: 'loans.lend',
      input: { bookTitle: 'Dune', dueAt: 'tomorrow' },
      caller: { subject: freshName('ada') },
    });
    expect(sent.decoded).toEqual({ ok: false, kind: 'validation', code: 'core.validation' });
    expect(sent.response.status).toBe(422);
  });

  test('no principal is unauthenticated', async () => {
    const sent = await sendCall(target, {
      action: 'loans.lend',
      input: { bookTitle: 'Dune', dueAt },
    });
    expect(sent.decoded).toEqual({
      ok: false,
      kind: 'unauthenticated',
      code: 'core.unauthenticated',
    });
    expect(sent.response.status).toBe(401);
  });

  test('a rule that does not allow is forbidden', async () => {
    const sent = await sendCall(target, {
      action: 'loans.closeAll',
      input: { borrower: 'ada' },
      caller: { subject: freshName('ada') },
    });
    expect(sent.decoded).toEqual({ ok: false, kind: 'forbidden', code: 'core.forbidden' });
    expect(sent.response.status).toBe(403);
  });

  test('a declared error keeps its own code and details', async () => {
    const subject = freshName('ada');
    const title = freshName('Dune');
    await sendCall(target, lendCall(subject, title));
    const again = await sendCall(target, lendCall(subject, title));
    expect(again.decoded).toEqual({ ok: false, kind: 'conflict', code: 'loans.already_lent' });
    expect(again.response.status).toBe(409);
  });

  test('a unique violation the command declares is its conflict', async () => {
    const isbn = freshName('isbn');
    const add = () =>
      sendCall(target, {
        action: 'library.addBook',
        input: { title: 'Emma', isbn },
        caller: { subject: freshName('ada') },
      });
    expect((await add()).decoded.ok).toBe(true);
    expect((await add()).decoded).toEqual({
      ok: false,
      kind: 'conflict',
      code: 'library.isbn_taken',
    });
  });

  test('a host that names no tenant is not found', async () => {
    const sent = await sendCall(target, {
      action: 'library.findByIsbn',
      input: { isbn: 'x' },
      caller: { subject: 'ada', host: 'nobody.example.test' },
    });
    expect(sent.decoded).toEqual({ ok: false, kind: 'not_found', code: 'core.not_found' });
    expect(sent.response.status).toBe(404);
  });

  test('every error carries the request id of its response', async () => {
    const sent = await sendCall(target, {
      action: 'loans.lend',
      input: { bookTitle: 'Dune', dueAt },
    });
    const id = sent.response.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(sent.body)).toContain(id ?? 'missing');
  });
}
