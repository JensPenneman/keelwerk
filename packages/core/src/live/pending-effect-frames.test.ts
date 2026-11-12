import { describe, expect, test } from 'vitest';
import {
  collect,
  createdFrame,
  effectRow,
  headFrame,
  idsOf,
  pendingBound,
  plainEntry,
  source,
} from '../../test/pending-effect-kit.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import { pendingEffectFrames } from './pending-effect-frames.ts';

describe('pendingEffectFrames', () => {
  test('start items wait for head and carry no state on a fresh start', async () => {
    const seen = await collect([createdFrame('a'), createdFrame('b'), headFrame('H1')]);
    expect(idsOf(seen)).toEqual(['a', 'b', 'head']);
    expect(seen[0]).toMatchObject({ event: { id: 'a', type: 'dispatch.ship' } });
    expect(seen[0]).not.toHaveProperty('state');
    expect(seen[0]).not.toHaveProperty('event.state');
    expect(seen[1]).not.toHaveProperty('state');
    expect(seen[2]).toEqual({ control: 'head', state: 'H1' });
  });

  test('start items carry the state the stream was opened with, never the state of head', async () => {
    const seen = await collect([createdFrame('a'), createdFrame('b'), headFrame('H1')], {
      after: 'R0',
    });
    expect(seen[0]).toMatchObject({ event: { id: 'a', state: 'R0' }, state: 'R0' });
    expect(seen[1]).toMatchObject({ event: { id: 'b', state: 'R0' }, state: 'R0' });
    expect(JSON.stringify(seen.slice(0, 2))).not.toContain('H1');
  });

  test('an effect whose deadline fails it between the snapshot and head never reaches the performer', async () => {
    const removed: LiveFrame<unknown> = {
      event: { type: 'removed', id: 'a', reason: 'left-view' },
    };
    const seen = await collect([createdFrame('a'), createdFrame('b'), removed, headFrame('H2')]);
    expect(idsOf(seen)).toEqual(['b', 'head']);
    const settled: LiveFrame<unknown> = {
      event: {
        type: 'changed',
        id: 'a',
        version: 2,
        row: effectRow('a', { status: 'failed' }),
      },
    };
    expect(idsOf(await collect([createdFrame('a'), settled, headFrame('H3')]))).toEqual(['head']);
  });

  test('a later item for a held id replaces it', async () => {
    const later: LiveFrame<unknown> = {
      event: {
        type: 'changed',
        id: 'a',
        version: 2,
        row: effectRow('a', { input: { parcel: 'newer', depot: 'north' } }),
      },
    };
    const seen = await collect([createdFrame('a'), createdFrame('b'), later, headFrame('H4')]);
    expect(idsOf(seen)).toEqual(['a', 'b', 'head']);
    expect(seen[0]).toMatchObject({ event: { input: { parcel: 'newer' } } });
  });

  test('removed and settled rows after head are dropped, live items carry their own state', async () => {
    const gone: LiveFrame<unknown> = { event: { type: 'removed', id: 'a', reason: 'left-view' } };
    const failed: LiveFrame<unknown> = {
      event: { type: 'changed', id: 'b', version: 2, row: effectRow('b', { status: 'failed' }) },
    };
    const archived: LiveFrame<unknown> = { event: { type: 'archived', id: 'c', version: 2 } };
    const seen = await collect([
      headFrame('H5'),
      gone,
      failed,
      archived,
      createdFrame('d', {}, 'S6'),
      { control: 'gap', missed: 2 },
    ]);
    expect(idsOf(seen)).toEqual(['head', 'd', 'gap']);
    expect(seen[1]).toMatchObject({ event: { id: 'd', state: 'S6' }, state: 'S6' });
  });

  test('the where reads the stored input', async () => {
    const where = { op: 'eq', field: 'depot', value: 'south' };
    const south = createdFrame('s', { input: { parcel: 'x', depot: 'south' } });
    const seen = await collect([createdFrame('n'), south, headFrame('H7')], { where });
    expect(idsOf(seen)).toEqual(['s', 'head']);
  });

  test('sealed members are left out', async () => {
    const seen = await collect([
      createdFrame('a', {
        input: { parcel: 'p', depot: 'north', recipient: { $kwe: 'sealed' }, token: 'secret-ref' },
      }),
      headFrame('H8'),
    ]);
    const item = seen[0] as { event: { input: Record<string, unknown> } };
    expect(item.event.input).toEqual({ parcel: 'p', depot: 'north' });
    expect(JSON.stringify(seen)).not.toContain('kwe');
    expect(JSON.stringify(seen)).not.toContain('secret-ref');
  });

  test('a stored envelope or secret under a plain member name is never carried', async () => {
    const envelope = { $kwe: 1, k: 'key-1', n: 'nonce', c: 'cipher' };
    const seen = await collect(
      [
        createdFrame('a', {
          input: {
            parcel: 'p',
            depot: 'north',
            recipient: envelope,
            notes: [envelope],
            token: 'kwv1.key-1.bm9uY2U.Y2lwaGVy',
            via: { ref: 'kwv1.key-1.bm9uY2U.Y2lwaGVy' },
          },
        }),
        headFrame('H8'),
      ],
      { plain: ['parcel', 'depot', 'recipient', 'notes', 'token', 'via'] },
    );
    const item = seen[0] as { event: { input: Record<string, unknown> } };
    expect(item.event.input).toEqual({ parcel: 'p', depot: 'north' });
    const json = JSON.stringify(seen);
    for (const leaked of ['kwe', 'key-1', 'nonce', 'cipher', 'kwv1']) {
      expect(json).not.toContain(leaked);
    }
    const where = { op: 'eq', field: 'recipient', value: 'x' };
    expect(idsOf(await collect([createdFrame('b'), headFrame('H9')], { where }))).toEqual(['head']);
    const over = { op: 'eq', field: 'recipient', value: 'x' };
    const sealedOnly = createdFrame('c', {
      input: { parcel: 'p', depot: 'north', recipient: envelope },
    });
    expect(
      idsOf(await collect([sealedOnly, headFrame('H9')], { where: over, plain: ['recipient'] })),
    ).toEqual(['head']);
  });

  test('the where and the item see domain values', async () => {
    const entry = {
      module: 'dispatch',
      input: shape({
        at: field.instant(),
        n: field.integer({ wide: true }),
        raw: field.binary(),
        tags: field.set(field.string()),
      }),
    } as unknown as EffectEntry;
    const at = Temporal.Instant.from('2026-11-12T10:00:00Z');
    const stored = encodeEventValue({
      at,
      n: 9n,
      raw: new Uint8Array([1, 2]),
      tags: new Set(['a', 'b']),
    });
    const frames = [createdFrame('a', { input: stored }), headFrame('H1')];
    const plain = ['at', 'n', 'raw', 'tags'];
    const wheres = [
      { op: 'gt', field: 'at', value: Temporal.Instant.from('2026-11-12T09:00:00Z') },
      { op: 'gte', field: 'n', value: 5n },
      { op: 'eq', field: 'raw', value: new Uint8Array([1, 2]) },
      { op: 'contains', field: 'tags', value: 'a' },
    ];
    for (const where of wheres) {
      const seen = await collect(frames, { plain, entry, where });
      expect(idsOf(seen), JSON.stringify(encodeEventValue(where))).toEqual(['a', 'head']);
    }
    const [first] = await collect(frames, { plain, entry });
    const input = (first as { event: { input: Record<string, unknown> } }).event.input;
    expect(input.at).toBeInstanceOf(Temporal.Instant);
    expect(input.n).toBe(9n);
    expect(input.raw).toBeInstanceOf(Uint8Array);
    expect(input.tags).toEqual(new Set(['a', 'b']));
    const unreadable = createdFrame('b', {
      input: { at: 'not an instant', n: '1', raw: '', tags: [] },
    });
    expect(idsOf(await collect([unreadable, headFrame('H2')], { plain, entry }))).toEqual(['head']);
  });

  test('reset drops what is held', async () => {
    const seen = await collect([createdFrame('a'), { control: 'reset', reason: 'resync' }]);
    expect(idsOf(seen)).toEqual(['reset']);
  });

  test('return reaches the inner stream', async () => {
    let returned = false;
    const stream = pendingEffectFrames(
      source([createdFrame('a'), headFrame('H9')], () => (returned = true)),
      {
        plain: ['parcel'],
        where: undefined,
        entry: plainEntry,
        after: undefined,
      },
      pendingBound,
    );
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(returned).toBe(true);
  });
});
