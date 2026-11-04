import { field, type StoredEvent, shape, verifyChain } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  addBooks,
  commandKit,
  invokeAsAda,
  snapshot,
  type WriteContext,
  withCommand,
} from './support/command-kit.ts';
import { openPglite } from './support/pglite-kit.ts';

async function chainOfTwo() {
  const { adapter, invoker } = commandKit();
  const [id = ''] = await addBooks(adapter, 1);
  await invokeAsAda(invoker, 'library.book.reserve', { id, ifVersion: 1 }, 'r1');
  const { events } = await snapshot(adapter, id);
  return { events };
}

function replaced(events: readonly StoredEvent[], index: number, patch: object) {
  return events.map((event, at) => (at === index ? { ...event, ...patch } : event));
}

describe('the chain of a stream written by commands', () => {
  test('every event links to the one before and hashes to its content', async () => {
    const { events } = await chainOfTwo();
    expect(events).toHaveLength(2);
    expect(events[0]?.prevHash).toBeNull();
    expect(events[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(events[1]?.prevHash).toBe(events[0]?.hash);
    expect(events[0]?.schemaVersion).toBe(1);
    expect(verifyChain(events)).toEqual({ ok: true, checked: 2 });
  });

  test('the clocks of a stream only grow', async () => {
    const { events } = await chainOfTwo();
    expect((events[1]?.hlc ?? '') > (events[0]?.hlc ?? '')).toBe(true);
  });

  test('a changed payload is found at its event', async () => {
    const { events } = await chainOfTwo();
    const found = verifyChain(replaced(events, 1, { data: { set: { reservedBy: 'mallory' } } }));
    expect(found).toMatchObject({ ok: false, version: 2, reason: 'hash', checked: 1 });
  });

  test('a changed writer, flag list, decision record or schema version is found too', async () => {
    const { events } = await chainOfTwo();
    const first = events[0] as StoredEvent;
    const patches = [
      { writer: { ...first.writer, revision: 9 } },
      { flags: [{ key: 'x', variant: 'on', reason: 'DEFAULT', ruleVersion: null }] },
      { decision: first.decision === null ? null : { ...first.decision, effects: ['e1'] } },
      { schemaVersion: 2 },
      { commandId: 'another' },
    ];
    for (const patch of patches) {
      expect(verifyChain(replaced(events, 0, patch))).toMatchObject({
        ok: false,
        version: 1,
        reason: 'hash',
      });
    }
  });

  test('a broken link and a removed first event are found', async () => {
    const { events } = await chainOfTwo();
    expect(verifyChain(replaced(events, 1, { prevHash: 'f'.repeat(64) }))).toMatchObject({
      ok: false,
      version: 2,
      reason: 'prev_hash',
    });
    expect(verifyChain(replaced(events, 0, { hash: null }))).toMatchObject({
      ok: false,
      version: 1,
      reason: 'missing',
    });
    expect(verifyChain(events.slice(1), { start: null })).toMatchObject({
      ok: false,
      reason: 'prev_hash',
    });
    expect(verifyChain(events.slice(1))).toMatchObject({
      ok: false,
      version: 2,
      reason: 'prev_hash',
    });
    expect(verifyChain(events.slice(1), { start: events[0]?.hash ?? null })).toEqual({
      ok: true,
      checked: 1,
    });
  });

  test('a transient flag set on a chain event is found, since it is not part of the content', async () => {
    const { events } = await chainOfTwo();
    expect(verifyChain(replaced(events, 1, { transient: true }))).toMatchObject({
      ok: false,
      version: 2,
      reason: 'missing',
    });
  });
});

describe('a command that changes two rows', () => {
  test('both streams verify: the decision record is frozen before any event is hashed', async () => {
    const probe = withCommand(
      'retitleBoth',
      (input: { first: string; second: string }, ctx: WriteContext) => [
        ctx.write.library.book.update(input.first, { title: 'One' }),
        ctx.write.library.book.update(input.second, { title: 'Two' }),
      ],
      'library.addBook',
      { input: shape({ first: field.string(), second: field.string() }) },
    );
    const { adapter, invoker } = commandKit({ registry: probe.registry });
    const [first = '', second = ''] = await addBooks(adapter, 2);
    await invokeAsAda(invoker, probe.ref, { first, second }, 'both');
    const one = (await snapshot(adapter, first)).events;
    const two = (await snapshot(adapter, second)).events;
    expect(one).toHaveLength(2);
    expect(one[1]?.decision?.reads).toHaveLength(2);
    expect(two[1]?.decision?.reads).toHaveLength(2);
    expect(verifyChain(one)).toEqual({ ok: true, checked: 2 });
    expect(verifyChain(two)).toEqual({ ok: true, checked: 2 });
  });
});

describe('the process clock', () => {
  test('commands in one runtime never repeat or lower a reading', async () => {
    const { adapter, invoker } = commandKit();
    const [first = '', second = ''] = await addBooks(adapter, 2);
    await invokeAsAda(invoker, 'library.book.reserve', { id: first, ifVersion: 1 }, 'c1');
    await invokeAsAda(invoker, 'library.book.reserve', { id: second, ifVersion: 1 }, 'c2');
    const a = (await snapshot(adapter, first)).events[1]?.hlc ?? '';
    const b = (await snapshot(adapter, second)).events[1]?.hlc ?? '';
    expect(a).not.toBe(b);
  });
});

describe('the stored format on PGlite', () => {
  test('two commands are written to SQL columns, read back and verified', async () => {
    const adapter = await openPglite();
    try {
      const { invoker } = commandKit({ adapter });
      const result = await invokeAsAda(
        invoker,
        'library.addBook',
        { title: 'Dune', isbn: 'isbn-1' },
        'p1',
      );
      const id = (result.output as { bookId: string }).bookId;
      await invokeAsAda(invoker, 'library.book.reserve', { id, ifVersion: 1 }, 'p2');
      const { events } = await snapshot(adapter, id);
      expect(events).toHaveLength(2);
      expect(events[0]?.decision?.reads).toBeDefined();
      expect(verifyChain(events)).toEqual({ ok: true, checked: 2 });
    } finally {
      await adapter.close(1000);
    }
  }, 60_000);
});
