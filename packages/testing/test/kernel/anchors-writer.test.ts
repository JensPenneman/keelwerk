import type { DataAdapter, LedgerSink, Logger } from '@keelwerk/core';
import { createAnchorWriter, verifyChain } from '@keelwerk/core';
import { encodeLedgerRecord } from '@keelwerk/core/ledger';
import { describe, expect, test, vi } from 'vitest';
import {
  anchorsOf,
  arraySink,
  bookShelf,
  steppedClock,
  targetsOf,
  tenantId,
  writer,
} from './support/anchor-kit.ts';
import { snapshot } from './support/command-kit.ts';
import { clock as fixedClock, namespace, open, silent, tenant } from './support/run-read-kit.ts';

describe('the anchor writer', () => {
  test('writes the head of a scope: its latest position, hash, stream, time and writer', async () => {
    const addBooks = bookShelf();
    const adapter = open();
    const [id = ''] = await addBooks(adapter, 1);
    const sink = arraySink();
    const anchors = createAnchorWriter({
      sinks: [sink],
      clock: fixedClock,
      writer,
      resolve: targetsOf(adapter),
      log: silent,
    });
    await anchors.onBatch([tenantId, 'a scope nobody resolves']);
    const { events } = await snapshot(adapter, id);
    const last = events.at(-1);
    expect(sink.records).toEqual([
      {
        type: 'anchor',
        scopeId: tenantId,
        position: String(last?.position),
        hash: last?.hash,
        stream: { type: 'library.book', id },
        recordedAt: '2026-01-01T00:00:00.000Z',
        writer,
      },
    ]);
    expect(verifyChain(events)).toEqual({ ok: true, checked: events.length });
    await anchors.onBatch([tenantId]);
    expect(sink.records).toHaveLength(1);
  });

  test('batch cadence: at most once per second per scope; the held-back head waits for the next batch or the flush', async () => {
    const addBooks = bookShelf();
    const adapter = open();
    const clock = steppedClock(Temporal.Instant.from('2026-01-01T00:00:00Z'));
    const sink = arraySink();
    const anchors = createAnchorWriter({
      sinks: [sink],
      every: 'batch',
      clock,
      writer,
      resolve: targetsOf(adapter),
      log: silent,
    });
    await addBooks(adapter, 1);
    await anchors.onBatch([tenantId]);
    await addBooks(adapter, 1);
    clock.advance(400);
    await anchors.onBatch([tenantId]);
    expect(anchorsOf(sink)).toHaveLength(1);
    clock.advance(700);
    await anchors.onBatch([]);
    expect(anchorsOf(sink)).toHaveLength(2);
    await addBooks(adapter, 1);
    clock.advance(10);
    await anchors.onBatch([tenantId]);
    expect(anchorsOf(sink)).toHaveLength(2);
    await anchors.flush();
    expect(anchorsOf(sink)).toHaveLength(3);
    expect(sink.records.map((record) => (record.type === 'anchor' ? record.position : ''))).toEqual(
      ['1', '2', '3'],
    );
  });

  test('an ISO 8601 cadence holds a scope back until the duration has passed', async () => {
    const addBooks = bookShelf();
    const adapter = open();
    const clock = steppedClock(Temporal.Instant.from('2026-01-01T00:00:00Z'));
    const sink = arraySink();
    const anchors = createAnchorWriter({
      sinks: [sink],
      every: 'PT1M',
      clock,
      writer,
      resolve: targetsOf(adapter),
      log: silent,
    });
    await addBooks(adapter, 1);
    await anchors.onBatch([tenantId]);
    await addBooks(adapter, 1);
    clock.advance(59_000);
    await anchors.onBatch([tenantId]);
    expect(anchorsOf(sink)).toHaveLength(1);
    clock.advance(1000);
    await anchors.onBatch([tenantId]);
    expect(anchorsOf(sink)).toHaveLength(2);
  });

  test('a sink that fails is logged and the others still get the batch; with every sink failing the scope is tried again', async () => {
    const addBooks = bookShelf();
    const adapter = open();
    await addBooks(adapter, 1);
    const good = arraySink();
    const bad: LedgerSink = {
      id: 'bad',
      append: async () => {
        throw new Error('disk full');
      },
      read: async function* () {},
    };
    const failures: string[] = [];
    const log: Logger = {
      ...silent,
      error: (message) => {
        failures.push(message);
      },
    };
    const anchors = createAnchorWriter({
      sinks: [bad, good],
      clock: fixedClock,
      writer,
      resolve: targetsOf(adapter),
      log,
    });
    await anchors.onBatch([tenantId]);
    expect(good.records).toHaveLength(1);
    expect(failures).toHaveLength(1);
    const alone = createAnchorWriter({
      sinks: [bad],
      clock: fixedClock,
      writer,
      resolve: targetsOf(adapter),
      log,
    });
    await alone.onBatch([tenantId]);
    await alone.onBatch([tenantId]);
    expect(failures).toHaveLength(3);
  });

  test('a scope held back by the cadence is anchored by the timer when no later batch comes', async () => {
    vi.useFakeTimers();
    try {
      const addBooks = bookShelf();
      const adapter = open();
      const clock = steppedClock(Temporal.Instant.from('2026-01-01T00:00:00Z'));
      const sink = arraySink();
      const anchors = createAnchorWriter({
        sinks: [sink],
        clock,
        writer,
        resolve: targetsOf(adapter),
        log: silent,
      });
      await addBooks(adapter, 1);
      await anchors.onBatch([tenantId]);
      await addBooks(adapter, 1);
      clock.advance(400);
      await anchors.onBatch([tenantId]);
      expect(anchorsOf(sink)).toHaveLength(1);
      clock.advance(600);
      await vi.advanceTimersByTimeAsync(600);
      expect(anchorsOf(sink)).toHaveLength(2);
      await anchors.flush();
      expect(anchorsOf(sink)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a scope whose head cannot be read, or a lookup that throws, does not cost the other scopes their anchor', async () => {
    const addBooks = bookShelf();
    const adapter = open();
    await addBooks(adapter, 1);
    const sink = arraySink();
    const failures: string[] = [];
    const log: Logger = { ...silent, error: (message) => void failures.push(message) };
    const broken: DataAdapter = {
      ...adapter,
      unit: async () => {
        throw new Error('placement down');
      },
    };
    let lookups = 0;
    const anchors = createAnchorWriter({
      sinks: [sink],
      clock: fixedClock,
      writer,
      resolve: async (ids) => {
        lookups += 1;
        if (lookups === 1) throw new Error('directory down');
        const found = await targetsOf(adapter)(ids);
        return new Map([
          ...found,
          ...(ids.has('broken')
            ? [['broken', { scope: tenant, namespace, handle: { adapter: broken } }] as const]
            : []),
        ]);
      },
      log,
    });
    await expect(anchors.onBatch([tenantId])).rejects.toThrow('directory down');
    await anchors.onBatch(['broken']);
    expect(anchorsOf(sink)).toEqual([`1@2026-01-01T00:00:00.000Z`]);
    expect(failures).toEqual(['the chain head of a scope could not be read for its anchor']);
    await anchors.flush();
    expect(failures).toHaveLength(2);
  });

  test('golden: a record the writer produced from a sub-millisecond clock carries three floored digits', async () => {
    const addBooks = bookShelf();
    const adapter = open();
    await addBooks(adapter, 1);
    const sink = arraySink();
    await createAnchorWriter({
      sinks: [sink],
      clock: { now: () => Temporal.Instant.from('2026-01-01T00:00:00.123456789Z') },
      writer,
      resolve: targetsOf(adapter),
      log: silent,
    }).onBatch([tenantId]);
    expect(
      sink.records.map((record) => encodeLedgerRecord(record).match(/"recordedAt":"[^"]*"/)?.[0]),
    ).toEqual(['"recordedAt":"2026-01-01T00:00:00.123Z"']);
  });

  test('a scope with no event gets no anchor', async () => {
    const sink = arraySink();
    await createAnchorWriter({
      sinks: [sink],
      clock: fixedClock,
      writer,
      resolve: targetsOf(open()),
      log: silent,
    }).onBatch([tenantId]);
    expect(sink.records).toEqual([]);
  });
});
