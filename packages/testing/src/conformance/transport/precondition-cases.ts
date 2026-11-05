import { expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

interface BookRow {
  readonly id: string;
  readonly isbn: string;
  readonly version: number;
}

async function newBook(target: TransportTarget, subject: string): Promise<BookRow> {
  const sent = await sendCall(target, {
    action: 'library.book.create',
    input: { title: 'First', isbn: freshName('isbn'), addedBy: subject },
    caller: { subject },
  });
  if (!sent.decoded.ok) throw new Error(`create failed: ${JSON.stringify(sent.decoded)}`);
  return sent.decoded.value as BookRow;
}

async function versionOf(target: TransportTarget, subject: string, book: BookRow): Promise<number> {
  const sent = await sendCall(target, {
    action: 'library.book.query',
    input: { filter: { isbn: book.isbn } },
    caller: { subject },
  });
  const items = sent.decoded.ok ? (sent.decoded.value as { items: BookRow[] }).items : [];
  return items[0]?.version ?? -1;
}

/**
 * Optimistic concurrency (16.4.9): an instance command names the row version it expects, as
 * `ifVersion` in the input or as `If-Match` on REST. `reserve` is the fixture's instance command.
 */
export function preconditionCases(target: TransportTarget): void {
  test('a command that names the current version runs and moves the version on', async () => {
    const ada = freshName('ada');
    const book = await newBook(target, ada);
    expect(book.version).toBe(1);
    const sent = await sendCall(target, {
      action: 'library.book.reserve',
      input: { id: book.id },
      ifVersion: book.version,
      caller: { subject: ada },
    });
    expect(sent.decoded.ok).toBe(true);
    expect(await versionOf(target, ada, book)).toBe(2);
  });

  test('a command that names an old version is a version mismatch and changes nothing', async () => {
    const ada = freshName('ada');
    const book = await newBook(target, ada);
    await sendCall(target, {
      action: 'library.book.reserve',
      input: { id: book.id },
      caller: { subject: ada },
    });
    const stale = await sendCall(target, {
      action: 'library.book.reserve',
      input: { id: book.id },
      ifVersion: book.version,
      caller: { subject: ada },
    });
    expect(stale.decoded).toEqual({ ok: false, kind: 'conflict', code: 'core.version_mismatch' });
    expect(stale.response.status).toBe(412);
    expect(await versionOf(target, ada, book)).toBe(2);
  });

  test('a command that names no version is unconditional', async () => {
    const ada = freshName('ada');
    const book = await newBook(target, ada);
    for (let round = 0; round < 2; round += 1) {
      const sent = await sendCall(target, {
        action: 'library.book.reserve',
        input: { id: book.id },
        caller: { subject: ada },
      });
      expect(sent.decoded.ok).toBe(true);
    }
    expect(await versionOf(target, ada, book)).toBe(3);
  });

  test('a write answers the version of the row it made, in the place the transport reports it', async () => {
    const ada = freshName('ada');
    const sent = await sendCall(target, {
      action: 'library.book.create',
      input: { title: 'Second', isbn: freshName('isbn'), addedBy: ada },
      caller: { subject: ada },
    });
    expect(sent.decoded.ok).toBe(true);
    expect(target.codec.rowVersionOf(sent)).toBe(1);
  });
}
