import type { Receipt } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { addBooks, commandKit, invokeAsAda, snapshot } from './support/command-kit.ts';
import { ada, call, failure } from './support/invoker-kit.ts';
import { namespace, tenant } from './support/run-read-kit.ts';

const input = { title: 'Dune', isbn: 'isbn-1' };

function pending(over: Partial<Receipt> = {}): Receipt {
  return {
    commandId: 'held',
    action: 'library.addBook',
    fingerprint: 'other',
    principal: null,
    status: 'pending',
    outcome: null,
    apiVersion: '2026-11-04',
    request: { transport: 'test', remoteAddress: null, userAgent: null },
    clientId: null,
    clientSeq: null,
    expiresAt: Temporal.Instant.from('2027-01-01T00:00:00Z'),
    ...over,
  };
}

describe('replay', () => {
  test('the same command id and input answers the recorded outcome without running again', async () => {
    const { adapter, invoker } = commandKit();
    const first = await invoker.invoke(
      call('library.addBook', input, { carrier: ada, commandId: 'c1' }),
    );
    const again = await invoker.invoke(
      call('library.addBook', input, { carrier: ada, commandId: 'c1' }),
    );
    expect(first).toMatchObject({ ok: true });
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(first.ok && again.ok && again.value).toEqual(first.ok && first.value);
    expect(first.ok && 'replayed' in first).toBe(false);
    const { books, events } = await snapshot(adapter, undefined, 'c1');
    expect(books).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  test('a replay of an entity command re-reads the row and answers the same id', async () => {
    const { adapter, invoker } = commandKit();
    const [id] = await addBooks(adapter, 1);
    const first = await invokeAsAda(invoker, 'library.book.reserve', { id }, 'r1');
    await invokeAsAda(invoker, 'library.book.reserve', { id }, 'r2');
    const again = await invokeAsAda(invoker, 'library.book.reserve', { id }, 'r1');
    expect(first.replayed).toBeUndefined();
    expect(again.replayed).toBe(true);
    expect(again.output).toMatchObject({ id, version: 3 });
  });

  test('the same command id with another input is core.idempotency_mismatch', async () => {
    const { adapter, invoker } = commandKit();
    await invoker.invoke(call('library.addBook', input, { carrier: ada, commandId: 'c1' }));
    const error = failure(
      await invoker.invoke(
        call('library.addBook', { ...input, isbn: 'isbn-2' }, { carrier: ada, commandId: 'c1' }),
      ),
    );
    expect(error).toMatchObject({ kind: 'conflict', code: 'core.idempotency_mismatch' });
    expect((await snapshot(adapter)).books).toHaveLength(1);
  });
});

describe('core.command_in_progress', () => {
  test('a receipt that is still pending answers a retryable conflict and runs nothing', async () => {
    const done = commandKit();
    await done.invoker.invoke(call('library.addBook', input, { carrier: ada, commandId: 'held' }));
    const { receipt } = await snapshot(done.adapter, undefined, 'held');
    const { adapter, invoker } = commandKit();
    await adapter.unit(namespace, tenant, async (unit) => {
      await unit.receipts.put(
        pending({ commandId: 'held', fingerprint: receipt?.fingerprint ?? '' }),
      );
    });
    const error = failure(
      await invoker.invoke(call('library.addBook', input, { carrier: ada, commandId: 'held' })),
    );
    expect(error).toMatchObject({
      kind: 'conflict',
      code: 'core.command_in_progress',
      retryable: true,
    });
    expect((await snapshot(adapter)).books).toHaveLength(0);
  });
});

describe('ReceiptStore.claim', () => {
  test('inserts once, answers exists afterwards and never changes the receipt', async () => {
    const { adapter } = commandKit();
    const kinds = await adapter.unit(namespace, tenant, async (unit) => {
      const first = await unit.receipts.claim(pending({ commandId: 'k', fingerprint: 'a' }));
      const second = await unit.receipts.claim(pending({ commandId: 'k', fingerprint: 'b' }));
      return { first, second, kept: (await unit.receipts.get('k'))?.fingerprint };
    });
    expect(kinds).toEqual({ first: 'inserted', second: 'exists', kept: 'a' });
  });
});
