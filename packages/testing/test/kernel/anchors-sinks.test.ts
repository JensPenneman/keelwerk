import type { LedgerSink } from '@keelwerk/core';
import { createAnchorWriter } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { arraySink, bookShelf, targetsOf, tenantId, writer } from './support/anchor-kit.ts';
import { clock as fixedClock, open, silent } from './support/run-read-kit.ts';

describe('the anchor writer across starts and refused appends', () => {
  test('seeded with the anchors already in the sinks, it does not anchor the same position again', async () => {
    const addBooks = bookShelf();
    const adapter = open();
    await addBooks(adapter, 1);
    const sink = arraySink();
    const start = () =>
      createAnchorWriter({
        sinks: [sink],
        clock: fixedClock,
        writer,
        resolve: targetsOf(adapter),
        log: silent,
      });
    await start().anchorNow([tenantId]);
    expect(sink.records).toHaveLength(1);
    const known = new Map<string, bigint>();
    for (const record of sink.records) {
      if (record.type === 'anchor') known.set(record.scopeId, BigInt(record.position));
    }
    await createAnchorWriter({
      sinks: [sink],
      clock: fixedClock,
      writer,
      resolve: targetsOf(adapter),
      log: silent,
      known,
    }).anchorNow([tenantId]);
    expect(sink.records).toHaveLength(1);
    await addBooks(adapter, 1);
    await createAnchorWriter({
      sinks: [sink],
      clock: fixedClock,
      writer,
      resolve: targetsOf(adapter),
      log: silent,
      known,
    }).anchorNow([tenantId]);
    expect(sink.records).toHaveLength(2);
  });

  test('keeps the last failure and the count of refused appends per sink', async () => {
    const addBooks = bookShelf();
    const adapter = open();
    await addBooks(adapter, 1);
    const refusing: LedgerSink = {
      id: 'refusing',
      append: async () => {
        throw new Error('disk full');
      },
      read: async function* () {},
    };
    const taking = arraySink();
    const anchors = createAnchorWriter({
      sinks: [refusing, taking],
      clock: fixedClock,
      writer,
      resolve: targetsOf(adapter),
      log: silent,
    });
    await anchors.onBatch([tenantId]);
    await anchors.flush();
    const status = anchors.sinkStatus?.() ?? [];
    expect(status.map((entry) => [entry.sink, entry.refusedAppends])).toEqual([
      ['refusing', 1],
      ['array', 0],
    ]);
    expect(status[0]?.lastFailure?.message).toBe('disk full');
    expect(status[1]?.lastFailure).toBeUndefined();
  });
});
