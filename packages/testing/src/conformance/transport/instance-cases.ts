import { describe, expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { responseRecord } from './response-record.ts';
import { sendCall } from './send-call.ts';
import type { Sent } from './sent.ts';
import type { TransportTarget } from './transport-target.ts';

const bookId = /^book_[0-9a-z]{26}$/;
const mismatch = { ok: false, kind: 'conflict', code: 'core.version_mismatch' } as const;

function rowOf(sent: Sent): Record<string, unknown> {
  return { ...responseRecord(sent.decoded.ok ? sent.decoded.value : undefined) };
}

async function newBook(target: TransportTarget, subject: string): Promise<string> {
  const sent = await sendCall(target, {
    action: 'library.book.create',
    input: { title: 'First', isbn: freshName('isbn'), addedBy: subject },
    caller: { subject },
  });
  const id = rowOf(sent).id;
  if (typeof id !== 'string') throw new Error(`create failed: ${JSON.stringify(sent.decoded)}`);
  return id;
}

/**
 * The generated instance commands (6.7, 16.4.2): `update` takes `{ id, patch, ifVersion? }`,
 * `archive` and `restore` take `{ id, ifVersion? }`, and every TypeID in the input, a `patch`
 * included, is decoded once by the transport.
 */
export function instanceCases(target: TransportTarget): void {
  describe('update', () => {
    test('a patch changes the members it names and moves the version on', async () => {
      const ada = freshName('ada');
      const id = await newBook(target, ada);
      const sent = await sendCall(target, {
        action: 'library.book.update',
        input: { id, patch: { title: 'Second' } },
        caller: { subject: ada },
      });
      expect(sent.decoded.ok).toBe(true);
      expect(rowOf(sent)).toMatchObject({ id, title: 'Second', addedBy: ada, version: 2 });
    });

    test('a TypeID inside the patch decodes to the row it names', async () => {
      const ada = freshName('ada');
      const id = await newBook(target, ada);
      const other = await newBook(target, ada);
      expect(other).toMatch(bookId);
      const sent = await sendCall(target, {
        action: 'library.book.update',
        input: { id, patch: { relatedTo: other } },
        caller: { subject: ada },
      });
      expect(sent.decoded.ok).toBe(true);
      expect(rowOf(sent)).toMatchObject({ id, relatedTo: other });
    });

    test('a TypeID of another entity inside the patch is a validation error', async () => {
      const ada = freshName('ada');
      const id = await newBook(target, ada);
      const sent = await sendCall(target, {
        action: 'library.book.update',
        input: { id, patch: { relatedTo: 'loan_01h455vb4pex5vsknk084sn02q' } },
        caller: { subject: ada },
      });
      expect(sent.decoded).toMatchObject({ ok: false, kind: 'validation' });
    });

    test('a stale ifVersion is a version mismatch and changes nothing', async () => {
      const ada = freshName('ada');
      const id = await newBook(target, ada);
      const sent = await sendCall(target, {
        action: 'library.book.update',
        input: { id, patch: { title: 'Late' } },
        ifVersion: 7,
        caller: { subject: ada },
      });
      expect(sent.decoded).toEqual(mismatch);
    });
  });

  describe('archive and restore', () => {
    test('a book is archived and restored, each moving the version on', async () => {
      const ada = freshName('ada');
      const id = await newBook(target, ada);
      const archived = await sendCall(target, {
        action: 'library.book.archive',
        input: { id },
        ifVersion: 1,
        caller: { subject: ada },
      });
      expect(archived.decoded.ok).toBe(true);
      expect(rowOf(archived)).toMatchObject({ id, version: 2 });
      const restored = await sendCall(target, {
        action: 'library.book.restore',
        input: { id },
        ifVersion: 2,
        caller: { subject: ada },
      });
      expect(restored.decoded.ok).toBe(true);
      expect(rowOf(restored)).toMatchObject({ id, version: 3 });
    });

    test('archiving at a stale version is a version mismatch', async () => {
      const ada = freshName('ada');
      const id = await newBook(target, ada);
      const sent = await sendCall(target, {
        action: 'library.book.archive',
        input: { id },
        ifVersion: 9,
        caller: { subject: ada },
      });
      expect(sent.decoded).toEqual(mismatch);
    });
  });
}
