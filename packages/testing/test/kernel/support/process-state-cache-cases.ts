import type { Scope, StoredEvent, Unit } from '@keelwerk/core';
import { foldProcessState } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import type { PgliteAdapter } from '@keelwerk/data/pglite';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { LoggedLine } from '../../../src/harness/logged-line.ts';
import { pgliteFactory } from '../../../src/harness/pglite-factory.ts';
import { recordingLogger } from '../../../src/harness/recording-logger.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import { appendTurnEvents } from './append-turn-events.ts';
import { loopRelayApp } from './loop-module.ts';
import { oldestPending, orderedPendingOf } from './ordered-pending-process.ts';
import { processInstanceStream } from './process-instance-stream.ts';
import { countingReads } from './process-state-cache-reads.ts';
import type { ReactionsKit } from './reactions-kit.ts';
import { bootReactions, relayOwner } from './reactions-kit.ts';

/** The stream the process state caches live in (S-124). */
const cacheStream = 'kernel:process-state';
const erasedLine = 'a process job found its subject erased and decides nothing';

/** An external database the caller started: the adapter factory, the application's URL and the owner's. */
type ExternalTarget = NonNullable<TestRuntimeOptions<'acme' | 'globex'>['external']> & {
  readonly adminUrl: string;
};

/** Where the cases run: an embedded adapter, or an external database that is created when the cases start. */
type Target =
  | { readonly adapter: 'memory' | 'pglite' }
  | { readonly external: () => Promise<ExternalTarget> };

/** The cache records of an instance, as the adapter's unit reads them: the stored form is unwrapped (below the sealing layer). */
const cacheOf = (kit: ReactionsKit, scope: Scope, streamId: string) =>
  kit.runtime.adapter.unit(
    kit.runtime.namespace,
    scope,
    async (unit) =>
      (await unit.streams.read(cacheStream, streamId, null, 10)).map((one) => one.data),
    { readOnly: true },
  );

/** Runs one statement as the database's owner and answers its rows; undefined on the memory adapter, which has no SQL. */
type OwnerQuery = (sql: string) => Promise<readonly Readonly<Record<string, unknown>>[]>;

/**
 * The state cache of a process instance (S-124, 7.7) on one adapter: an instance of 10,000 events
 * decides with one read of the cache and one of the stream, two workers' interleavings fold what a
 * full fold folds, a process with a data subject keeps its cache sealed, and erasing the subject
 * makes the cache unreadable, so the job decides what it decides without one.
 */
export function processStateCacheCases(target: Target): void {
  const log: string[] = [];
  const lines: LoggedLine[] = [];
  let kit: ReactionsKit;
  let scope: Scope;
  let cycleStream: { readonly type: string; readonly id: string };
  let tallyStream: { readonly type: string; readonly id: string };
  /** The build id the runtime writes into every event it appends. */
  let build = '';

  /** The owner's connection of an external database, closed after the cases. */
  let owner: pg.Client | undefined;
  let ownerQuery: OwnerQuery | undefined;
  /**
   * The rows of the cache stream of an instance exactly as the table holds them (`data` of
   * `kw_stream_records`: `{"record": ...}`) on PGlite and PostgreSQL; the memory adapter has no
   * table, so its collection is read through the unit.
   */
  const rawCacheRows = async (streamId: string): Promise<readonly unknown[]> => {
    if (ownerQuery === undefined) return cacheOf(kit, scope, streamId);
    const rows = await ownerQuery(
      `select data from "${kit.runtime.namespace.root}".kw_stream_records where stream = '${cacheStream}' and key = '${streamId}' order by seq`,
    );
    return rows.map((row) => row.data);
  };

  const inUnit = <T>(fn: (unit: Unit) => Promise<T>, readOnly = false): Promise<T> =>
    kit.runtime.adapter.unit(kit.runtime.namespace, scope, fn, { readOnly });
  /** A unit of the sealing layer, as a worker's: it opens personal values. */
  const sealed = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
    kit.runtime.sealed.unit(kit.runtime.namespace, scope, fn, { readOnly: true });
  const reactionOf = (id: string) => {
    const found = kit.runtime.app.registry.reactions.get(id);
    if (found === undefined) throw new Error(`the app has no reaction ${id}`);
    return found;
  };
  /** The state a fold gives, with the cache of this build and without it. */
  const folds = async (id: 'loop.cycle' | 'relay.tally', stream: { readonly id: string }) => {
    const subject = id === 'relay.tally' ? relayOwner : undefined;
    log.length = 0;
    const withCache = await sealed((unit) =>
      foldProcessState(unit, reactionOf(id), stream.id, subject, undefined, build),
    );
    const reads = [...log];
    const without = await sealed((unit) =>
      foldProcessState(unit, reactionOf(id), stream.id, subject),
    );
    return { withCache, without, reads };
  };
  const hashesOf = (
    stream: { readonly type: string; readonly id: string },
    from: number,
    limit: number,
  ) =>
    inUnit(
      async (unit) =>
        (await unit.events.readStream(stream, { fromVersion: from, limit })).map(
          (event: StoredEvent) => ({ version: event.version, hash: event.hash }),
        ),
      true,
    );
  const replaceCache = (streamId: string, records: readonly unknown[]) =>
    inUnit(async (unit) => {
      await unit.streams.purgeKeys(cacheStream, [streamId]);
      for (const record of records) await unit.streams.append(cacheStream, streamId, [record]);
    });

  describe('the process state cache', () => {
    beforeAll(async () => {
      const entities = new Map(
        [...loopRelayApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
      );
      const lookup = (ref: string) => entities.get(ref);
      const external = 'external' in target ? await target.external() : undefined;
      const base =
        external !== undefined
          ? external.factory
          : 'adapter' in target && target.adapter === 'pglite'
            ? pgliteFactory({ entities: lookup })
            : memoryAdapter({ entities: lookup });
      const url =
        external !== undefined
          ? external.url
          : `${'adapter' in target ? target.adapter : 'memory'}://process-state-cache`;
      kit = await bootReactions({
        app: loopRelayApp,
        maxDepth: 4,
        logger: recordingLogger(lines),
        external: { factory: countingReads(base, log, cacheStream), url },
      });
      if (external !== undefined) {
        owner = new pg.Client({ connectionString: external.adminUrl });
        await owner.connect();
        const client = owner;
        ownerQuery = async (sql) => (await client.query(sql)).rows;
      } else if ('adapter' in target && target.adapter === 'pglite') {
        const embedded = kit.runtime.adapter as unknown as PgliteAdapter;
        ownerQuery = (sql) =>
          embedded.asOwner(async (database) => (await database.query(sql)).rows as never);
      }
      scope = kit.scopeOf('acme');
      cycleStream = await processInstanceStream(kit.runtime.keys, scope, 'loop.cycle', 'process');
      tallyStream = await processInstanceStream(kit.runtime.keys, scope, 'relay.tally', relayOwner);
    }, 120_000);
    afterAll(async () => {
      await kit.stop();
      await owner?.end();
    });

    /** Appends `count` events of the process `loop.cycle` to an instance's stream (the first one's by default). */
    const appendTurns = (count: number, into = cycleStream) =>
      appendTurnEvents(inUnit, into, count);

    test('an instance of 10,000 events decides its next event with one cache read and one stream read', {
      timeout: 180_000,
    }, async () => {
      await appendTurns(10_000);
      const first = await kit.call('acme', 'loop.start', { via: 'process' });
      expect(first.ok).toBe(true);
      await kit.settle();
      // The writer of an event the runtime appended names the build the jobs run under.
      const [beat] = await kit.rows('acme', 'loop.beat');
      const [appended] = await inUnit(
        (unit) => unit.events.readStream({ type: 'loop.beat', id: String(beat?.id) }),
        true,
      );
      build = appended?.writer.build ?? '';
      expect(build).not.toBe('');
      // The first job folded the stream and wrote the cache at its head.
      const [record] = await cacheOf(kit, scope, cycleStream.id);
      expect(record).toMatchObject({ v: 1, version: 10_000, text: '{"turns":10000}' });
      const [head] = await hashesOf(cycleStream, 10_000, 1);
      expect(record).toMatchObject({ hash: head?.hash });

      // The chain runs again: each of its two process jobs reads the cache once and the stream once, from the cached version.
      log.length = 0;
      const again = await kit.call('acme', 'loop.start', { via: 'process' });
      expect(again.ok).toBe(true);
      await kit.settle();
      expect(log).toEqual(['cache', 'stream:loop.cycle@10000', 'cache', 'stream:loop.cycle@10000']);
    });

    test('the interleavings of two workers fold what a full fold folds', {
      timeout: 120_000,
    }, async () => {
      const [stored] = await cacheOf(kit, scope, cycleStream.id);
      const from = (stored as { from: string }).from;
      const [first, second] = await hashesOf(cycleStream, 10_001, 2);
      if (first === undefined || second === undefined) throw new Error('the stream is short');
      const at = (entry: { version: number; hash: string | null }) => ({
        v: 1,
        from,
        version: entry.version,
        hash: entry.hash,
        text: JSON.stringify({ turns: entry.version }),
      });
      const [total] = await hashesOf(cycleStream, 10_004, 1);
      expect(total?.version).toBe(10_004);

      // Versions n and n + 1, written in both orders, and the stream one event past version n.
      const cases: readonly [string, readonly unknown[], string][] = [
        ['n then n + 1', [at(first), at(second)], 'stream:loop.cycle@10002'],
        ['n + 1 then n', [at(second), at(first)], 'stream:loop.cycle@10002'],
        ['n with the stream past it', [at(first)], 'stream:loop.cycle@10001'],
      ];
      for (const [, records, read] of cases) {
        await replaceCache(cycleStream.id, records);
        const { withCache, without, reads } = await folds('loop.cycle', cycleStream);
        expect(withCache).toEqual(without);
        expect(withCache).toMatchObject({ state: { turns: 10_004 }, version: 10_004 });
        expect(reads).toEqual(['cache', read]);
      }

      // A record whose version is past the head of the stream is not used.
      await replaceCache(cycleStream.id, [{ ...at(first), version: 10_009, hash: 'f'.repeat(64) }]);
      const past = await folds('loop.cycle', cycleStream);
      expect(past.withCache).toEqual(past.without);
      expect(past.reads.slice(0, 2)).toEqual(['cache', 'stream:loop.cycle@10009']);
      expect(past.reads).toContain('stream:loop.cycle@1');
    });

    test('a plain state whose members are not in sorted order is cached as text and decides what a fold without a cache decides', async () => {
      // The oldest entry is the first key. A jsonb column would sort the keys, shorter names first:
      // ord-9 before ord-10, so a cache kept as a value would ship another entry than the stream's fold.
      const stream = await processInstanceStream(
        kit.runtime.keys,
        scope,
        'loop.cycle',
        'insertion-order',
      );
      await appendTurns(40, stream);
      const ordered = orderedPendingOf(reactionOf('loop.cycle'));
      const writable = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
        kit.runtime.sealed.unit(kit.runtime.namespace, scope, fn, { readOnly: false });

      const without = await writable((unit) =>
        foldProcessState(unit, ordered, stream.id, undefined),
      );
      expect(oldestPending(without.state)).toBe('ord-10');
      // The fold of 40 events writes the cache; the next fold takes its state from it.
      await writable((unit) =>
        foldProcessState(unit, ordered, stream.id, undefined, undefined, build),
      );
      const [row] = await rawCacheRows(stream.id);
      const record = (ownerQuery === undefined ? row : (row as { record: unknown }).record) as {
        text?: unknown;
      };
      expect(record.text).toBe(JSON.stringify(without.state));
      log.length = 0;
      const cached = await writable((unit) =>
        foldProcessState(unit, ordered, stream.id, undefined, undefined, build),
      );
      // The state came from the cache: one cache read, and the stream read from the cached version only.
      expect([...log]).toEqual(['cache', 'stream:loop.cycle@40']);
      expect(cached.version).toBe(40);
      expect(oldestPending(cached.state)).toBe('ord-10');
      expect(JSON.stringify(cached.state)).toBe(JSON.stringify(without.state));
    });

    test('a tally instance past 32 events is cached sealed: the record holds "$kwe":2 and no note text', {
      timeout: 180_000,
    }, async () => {
      for (let n = 0; n < 34; n += 1) {
        const sent = await kit.send('acme', {
          channel: 'cached',
          contact: `private-note-${String(n)}`,
        });
        expect(sent.ok).toBe(true);
      }
      await kit.settle();
      // The raw row of the table, not what the adapter's unit makes of it.
      const rows = await rawCacheRows(tallyStream.id);
      expect(rows).toHaveLength(1);
      const [row] = rows as Record<string, unknown>[];
      if (ownerQuery !== undefined) expect(Object.keys(row ?? {})).toEqual(['record']);
      const record = (ownerQuery === undefined ? row : row?.record) as
        | { v: number; from: string; version: number; hash: string | null; sealed?: unknown }
        | undefined;
      // A jsonb column does not keep the order of the members: only the set is compared.
      expect(Object.keys(record ?? {}).sort()).toEqual(['from', 'hash', 'sealed', 'v', 'version']);
      expect(record).toMatchObject({ v: 1 });
      expect(record?.version).toBeGreaterThanOrEqual(32);
      expect(record).not.toHaveProperty('text');
      expect(record?.sealed).toMatchObject({ $kwe: 2 });
      const text = JSON.stringify(rows);
      expect(text).toContain('"$kwe":2');
      expect(text).not.toContain('private-note');
      // The stream's own events hold no note text in the clear either.
      const events = await inUnit((unit) => unit.events.readStream(tallyStream), true);
      expect(events.length).toBeGreaterThanOrEqual(34);
      expect(JSON.stringify(events.map((event) => event.data))).not.toContain('private-note');
    });

    test('the 34th signal of a cached instance decides the same echo (count 33) as a run without cache', async () => {
      const echoes = (await kit.rows('acme', 'relay.echo')).filter(
        (row) => row.reaction === 'relay.tally' && row.channel === 'cached',
      );
      expect(echoes).toHaveLength(34);
      const counts = echoes.map((row) => Number(row.count)).sort((a, b) => a - b);
      expect(counts).toEqual(Array.from({ length: 34 }, (_, n) => n));
      const last = echoes.find((row) => Number(row.count) === 33);
      const lengths = Array.from({ length: 33 }, (_, n) => `private-note-${String(n)}`.length);
      // The note of each earlier signal was seen in the clear: its length is in the echo, and the order is the stream's.
      expect(String(last?.seenText)).toBe(lengths.join(','));
      // A fold of the stream with the cache and one without it are the same state.
      const { withCache, without, reads } = await folds('relay.tally', tallyStream);
      expect(withCache).toEqual(without);
      expect(reads[0]).toBe('cache');
      expect(reads[1]).not.toBe('stream:relay.tally@1');
    });

    test('after the subject is shredded the cached state does not open and the fold equals a fold without cache (notes read "(gone)")', async () => {
      // Sent before the shred and left unsettled: a write that names an erased subject is refused, so
      // the job that meets the erasure belongs to an event written before it (the next test).
      const sent = await kit.send('acme', { channel: 'after-erasure' });
      expect(sent.ok).toBe(true);
      await inUnit((unit) => unit.keys.shred(relayOwner));
      const { withCache, without, reads } = await folds('relay.tally', tallyStream);
      expect(withCache).toEqual(without);
      const state = withCache.state as { count: number; notes: readonly string[] };
      expect(state.count).toBeGreaterThanOrEqual(34);
      expect(new Set(state.notes)).toEqual(new Set(['(gone)']));
      // The cache was read and refused: the fold started again at the first event.
      expect(reads[0]).toBe('cache');
      expect(reads).toContain('stream:relay.tally@1');
      // The refused cache holds no note text.
      expect(JSON.stringify(await rawCacheRows(tallyStream.id))).not.toContain('private-note');
    });

    test('after the shred the tally job of an event written before it decides nothing, one "subject erased" line', async () => {
      lines.length = 0;
      const before = (await kit.rows('acme', 'relay.echo')).filter(
        (row) => row.reaction === 'relay.tally',
      ).length;
      await kit.settle();
      const after = (await kit.rows('acme', 'relay.echo')).filter(
        (row) => row.reaction === 'relay.tally',
      ).length;
      expect(after).toBe(before);
      expect(lines.filter((line) => line.message === erasedLine)).toHaveLength(1);
      expect(JSON.stringify(lines)).not.toContain(relayOwner);
    });
  });
}
