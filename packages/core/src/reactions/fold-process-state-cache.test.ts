import { describe, expect, test } from 'vitest';
import {
  build,
  eventsUpTo,
  fake,
  plainTally,
  recorded,
  stream,
  subject,
  subjectTally,
} from '../../test/process-state-cache-kit.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { foldProcessState } from './fold-process-state.ts';
import { processStateFrom } from './process-state-from.ts';

const GOLDEN_PLAIN =
  '{"v":1,"from":"368d50ad99a5f58bd8c31790241356e6147f075db9212667fed43af5bdb9bfce","version":10000,"hash":"hash-10000","text":"{\\"count\\":10000}"}';
const GOLDEN_SEALED =
  '{"v":1,"from":"368d50ad99a5f58bd8c31790241356e6147f075db9212667fed43af5bdb9bfce","version":40,"hash":"hash-40","sealed":{"$kwe":2,"k":"dk-1","n":"AQEBAQEBAQEBAQEB","c":"DcPq2OXRmCzr4Oxc8DdwMaj7FPQYlzsTWDFDYma0NrusbrCp8oaOXvxWMnRo0XFT"}}';

/** What a `jsonb` column keeps of a value: the members of every object sorted, shorter names first. */
function jsonbOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOf);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, member]) => [name, jsonbOf(member)]),
  );
}

/** Folds with the test's build, or with none when `withBuild` is `null`. */
const fold = (unit: Unit, reaction: ReactionEntry, withBuild: string | null = build) =>
  foldProcessState(
    unit,
    reaction,
    stream.id,
    reaction === subjectTally ? subject : undefined,
    undefined,
    withBuild ?? undefined,
  );

/** What a fold of the whole stream, with no cache, decides. */
const uncached = async (reaction: ReactionEntry, stored: readonly StoredEvent[]) =>
  fold(fake(stored).unit, reaction, null);

/** The cache record a fold of `count` events writes (the stream is read once to write it). */
async function cacheOf(reaction: ReactionEntry, count: number, shredded = false): Promise<unknown> {
  const written = fake(eventsUpTo(count), { shredded });
  await fold(written.unit, reaction);
  const [record] = written.records();
  return record;
}

describe('folding with the state cache of a process instance', () => {
  test('an instance of 10,000 events writes its cache at the head, and the next fold reads one record and one page from that version', async () => {
    const stored = eventsUpTo(10_000);
    const first = fake(stored);
    const folded = await fold(first.unit, plainTally);
    expect(folded).toMatchObject({
      state: { count: 10_000 },
      version: 10_000,
      lastHash: 'hash-10000',
    });
    expect(first.appends).toHaveLength(1);
    expect(first.appends[0]).toMatchObject({
      v: 1,
      version: 10_000,
      hash: 'hash-10000',
      text: '{"count":10000}',
    });
    // The stored form, byte for byte: the members in this order, `from` as hexadecimal text.
    expect(JSON.stringify(first.appends[0])).toBe(GOLDEN_PLAIN);
    expect(first.records()).toHaveLength(1);
    expect(first.streamReads).toHaveLength(21);

    const next = fake(stored, { held: first.records() });
    const again = await fold(next.unit, plainTally);
    expect(again).toEqual(folded);
    expect(next.cacheReads).toHaveLength(1);
    expect(next.streamReads).toEqual([10_000]);
    expect(next.appends).toEqual([]);
    expect(next.purges).toEqual([]);
  });

  test('a cache folds only what is newer, from its own version', async () => {
    const held = [await cacheOf(plainTally, 100)];
    const stored = eventsUpTo(110);
    const next = fake(stored, { held });
    const folded = await fold(next.unit, plainTally);
    expect(folded).toMatchObject({ state: { count: 110 }, version: 110, lastHash: 'hash-110' });
    expect(next.streamReads).toEqual([100]);
  });

  test('a long gap after the cache is read in pages, and the warning counts the events past it', async () => {
    const held = [await cacheOf(plainTally, 40)];
    const next = fake(eventsUpTo(1500), { held });
    const lines: unknown[] = [];
    const folded = await foldProcessState(
      next.unit,
      plainTally,
      stream.id,
      undefined,
      { warn: (message: string, fields: unknown) => lines.push([message, fields]) } as never,
      build,
    );
    expect(folded).toMatchObject({ state: { count: 1500 }, version: 1500 });
    expect(next.streamReads[0]).toBe(40);
    expect(lines).toEqual([
      ['a process folded a long stream', { process: 'logs.tally', events: 1460 }],
    ]);
  });

  describe.each([
    ['plain', plainTally],
    ['sealed', subjectTally],
  ])('a %s process', (_name, reaction) => {
    const stored = eventsUpTo(100);
    const from = processStateFrom(reaction, build) as string;
    const record = (over: object) => ({
      v: 1,
      from,
      version: 40,
      hash: 'hash-40',
      text: '{"count":999}',
      ...over,
    });
    /** A record of the other form than the process keeps: sealed for a plain process, plain for a subject process. */
    const otherForm = async (): Promise<unknown> => {
      if (reaction === subjectTally) return record({});
      const { sealed } = (await cacheOf(subjectTally, 40)) as { sealed: unknown };
      const { text: _text, ...bare } = record({});
      return { ...bare, sealed };
    };
    type Row = readonly [string, () => Promise<unknown[]>, boolean];

    test.each<Row>([
      ['missing', async () => [], false],
      ['older (and right)', async () => [await cacheOf(reaction, 40)], false],
      ['of another build', async () => [record({ from: 'f'.repeat(64) })], false],
      ['malformed', async () => [{ junk: true }, 'text', null], false],
      ['of another hash', async () => [record({ hash: 'hash-other' })], false],
      ['at a version without a hash', async () => [record({ hash: null })], false],
      ['past the stream', async () => [record({ version: 101, hash: 'hash-101' })], false],
      [
        'of the other form (sealed for a plain process, plain for a subject process)',
        async () => [await otherForm()],
        false,
      ],
      [
        'unopenable (the subject was erased since)',
        async () => [await cacheOf(reaction, 40)],
        true,
      ],
    ])('a cache that is %s folds exactly what no cache folds', async (_case, held, shredded) => {
      const expected = await uncached(reaction, stored);
      const unit = fake(stored, { held: await held(), shredded }).unit;
      expect(await fold(unit, reaction)).toEqual(expected);
      expect(expected).toMatchObject({ state: { count: 100 }, version: 100 });
    });
  });

  test('two records after a race: the higher valid version is used, and either gives the state of a full fold', async () => {
    const low = await cacheOf(plainTally, 50);
    const high = await cacheOf(plainTally, 51);
    const stored = eventsUpTo(60);
    const expected = await uncached(plainTally, stored);
    for (const held of [
      [low, high],
      [high, low],
    ]) {
      const next = fake(stored, { held });
      expect(await fold(next.unit, plainTally)).toEqual(expected);
      expect(next.streamReads).toEqual([51]);
    }
    // Only the lower one is left (the other worker's purge removed the higher): the fold goes on from it.
    const left = fake(stored, { held: [low] });
    expect(await fold(left.unit, plainTally)).toEqual(expected);
    expect(left.streamReads).toEqual([50]);
  });

  test('a record newer than the stream (version past its head) is not used', async () => {
    const ahead = await cacheOf(plainTally, 70);
    const stored = eventsUpTo(60);
    const next = fake(stored, { held: [ahead] });
    expect(await fold(next.unit, plainTally)).toEqual(await uncached(plainTally, stored));
    // A record at the head's own version but of another event is not used either.
    const forked = [...stored.slice(0, 59), { ...recorded(60), hash: 'hash-forked' }];
    const other = fake(forked, { held: [await cacheOf(plainTally, 60)] });
    expect(await fold(other.unit, plainTally)).toEqual(await uncached(plainTally, forked));
  });

  test('a state that is no plain JSON, a fold below 32 new events, a read-only unit and a fold without build write no cache', async () => {
    const stored = eventsUpTo(40);
    const dated = {
      ...(plainTally as object),
      evolve: (state: { count: number }) => ({ count: state.count + 1, when: new Date(0) }),
    } as unknown as ReactionEntry;
    const noJson = fake(stored);
    await fold(noJson.unit, dated);
    expect(noJson.appends).toEqual([]);
    expect(noJson.purges).toEqual([]);

    const few = fake(eventsUpTo(31));
    await fold(few.unit, plainTally);
    expect(few.appends).toEqual([]);

    const readOnly = fake(stored, { readOnly: true });
    await fold(readOnly.unit, plainTally);
    expect(readOnly.appends).toEqual([]);
    expect(readOnly.cacheReads).toHaveLength(1);

    const bare = fake(stored);
    await fold(bare.unit, plainTally, null);
    expect(bare.appends).toEqual([]);
    expect(bare.cacheReads).toEqual([]);

    const written = fake(stored);
    await fold(written.unit, plainTally);
    expect(written.appends).toHaveLength(1);
  });

  test('a process whose initial state is no plain JSON has no cache at all', async () => {
    const odd = {
      ...(plainTally as object),
      initial: { count: 0, fn: () => 1 },
    } as unknown as ReactionEntry;
    const unit = fake(eventsUpTo(40));
    await fold(unit.unit, odd);
    expect(unit.cacheReads).toEqual([]);
    expect(unit.appends).toEqual([]);
  });

  test('a fold under the refresh writes nothing; one at 32 writes once', async () => {
    const held = [await cacheOf(plainTally, 40)];
    const under = fake(eventsUpTo(71), { held });
    await fold(under.unit, plainTally);
    expect(under.appends).toEqual([]);
    expect(under.purges).toEqual([]);
    expect(under.records()).toEqual(held);

    const at = fake(eventsUpTo(72), { held });
    await fold(at.unit, plainTally);
    expect(at.purges).toEqual([1]);
    expect(at.appends).toHaveLength(1);
    expect(at.appends[0]).toMatchObject({ version: 72, hash: 'hash-72', text: '{"count":72}' });
    expect(at.records()).toHaveLength(1);
  });

  test('a cache kept by a store that reorders object members decides what a fold without a cache decides', async () => {
    // The order of the members is what the process decides on: its oldest entry is the first key.
    // Entry names are added in the order ord-10, ord-9, then one per event.
    const ordered = {
      ...(plainTally as object),
      initial: { pending: {} },
      evolve: (state: { pending: Record<string, number> }, event: { version: number }) => ({
        pending: {
          ...state.pending,
          [event.version === 1
            ? 'ord-10'
            : event.version === 2
              ? 'ord-9'
              : `ord-1${event.version}`]: event.version,
        },
      }),
    } as unknown as ReactionEntry;
    const oldest = (state: unknown): string | undefined =>
      Object.keys((state as { pending: object }).pending)[0];
    const stored = eventsUpTo(41);
    const expected = await uncached(ordered, stored);
    expect(oldest(expected.state)).toBe('ord-10');

    const written = fake(stored.slice(0, 40));
    await fold(written.unit, ordered);
    expect(written.appends).toHaveLength(1);
    // What a jsonb column makes of the record: members sorted, shorter names first.
    const held = written.records().map(jsonbOf);
    const next = fake(stored, { held });
    const folded = await fold(next.unit, ordered);
    expect(next.streamReads).toEqual([40]);
    expect(oldest(folded.state)).toBe('ord-10');
    expect(JSON.stringify(folded.state)).toBe(JSON.stringify(expected.state));
  });

  // WP-130: $kwe 2 pads the plaintext (S8) and the process stream id binds its owner; the envelope
  // and every hash over it were regenerated.
  test('a process with a data subject keeps only the sealed state, bound to the event at its version', async () => {
    const written = fake(eventsUpTo(40));
    await fold(written.unit, subjectTally);
    const [record] = written.appends as { sealed?: unknown; text?: unknown; version: number }[];
    expect(record).toBeDefined();
    expect(record).not.toHaveProperty('text');
    expect(record?.sealed).toMatchObject({ $kwe: 2, k: 'dk-1' });
    expect(record?.version).toBe(40);
    // The stored form, byte for byte, under the kit's fixed key and nonce.
    expect(JSON.stringify(record)).toBe(GOLDEN_SEALED);
    // A shredded subject writes no cache.
    const erased = fake(eventsUpTo(40), { shredded: true });
    await fold(erased.unit, subjectTally);
    expect(erased.appends).toEqual([]);
  });
});
