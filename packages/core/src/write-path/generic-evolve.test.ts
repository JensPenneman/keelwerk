import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { changedOpsOf } from './changed-ops-of.ts';
import { defaultNodeId } from './default-node-id.ts';
import { encodeEventValue } from './encode-event-value.ts';
import type { EvolvingEvent } from './evolving-event.ts';
import { genericEvolve } from './generic-evolve.ts';
import { nextHlc } from './next-hlc.ts';

function field(
  kind: FieldDescriptor['kind'],
  over: Partial<FieldDescriptor> = {},
): FieldDescriptor {
  return {
    kind,
    column: kind,
    optional: false,
    unique: false,
    indexed: false,
    hidden: false,
    maskable: false,
    stateOnly: false,
    sealed: false,
    merge: 'lww',
    personal: false,
    constraints: {},
    ref: null,
    inner: null,
    codec: null,
    tag: 0,
    ...over,
  };
}

const entry = {
  ref: 'test.item',
  descriptor: {
    fields: {
      title: field('string'),
      note: field('text', { optional: true }),
      count: field('integer', { merge: 'counter' }),
      big: field('integer', { constraints: { wide: true }, optional: true }),
      due: field('instant', { optional: true }),
      done: field('boolean'),
      tags: field('set', { merge: 'set', inner: field('string'), optional: true }),
    },
  },
} as unknown as EntityEntry;

const instant = fc
  .integer({ min: 0, max: 4_000_000_000_000 })
  .map((ms) => Temporal.Instant.fromEpochMilliseconds(ms));

type Op =
  | { readonly kind: 'update'; readonly patch: Record<string, unknown> }
  | { readonly kind: 'archive' }
  | { readonly kind: 'restore' };

const patch = fc
  .record(
    {
      title: fc.string({ minLength: 1, maxLength: 8 }),
      note: fc.option(fc.string({ maxLength: 8 }), { nil: undefined }),
      count: fc.integer({ min: -5, max: 5 }).map((by) => ({ inc: by })),
      big: fc.option(fc.bigInt({ min: -(2n ** 62n), max: 2n ** 62n }), { nil: null }),
      due: fc.option(instant, { nil: null }),
      done: fc.boolean(),
      tags: fc.oneof(
        fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 4 }).map((t) => new Set(t)),
        fc.record(
          {
            add: fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 3 }),
            remove: fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 3 }),
          },
          { requiredKeys: [] },
        ),
      ),
    },
    { requiredKeys: [] },
  )
  .filter((value) => Object.keys(value).length > 0);

const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: patch.map((value): Op => ({ kind: 'update', patch: value })) },
  { weight: 1, arbitrary: fc.constant<Op>({ kind: 'archive' }) },
  { weight: 1, arbitrary: fc.constant<Op>({ kind: 'restore' }) },
);

const created = fc.record({
  title: fc.string({ minLength: 1, maxLength: 8 }),
  count: fc.integer({ min: 0, max: 9 }),
  done: fc.boolean(),
  due: instant,
});

describe('the generic evolve', () => {
  test('the inline projection equals a rebuild from the stored log', () => {
    fc.assert(
      fc.property(created, fc.array(op, { maxLength: 12 }), instant, (start, ops, at) => {
        const id = '00000000-0000-7000-8000-000000000001';
        const log: { name: string; data: unknown; hlc: string }[] = [];
        let counter = 0;
        const base = (): Pick<EvolvingEvent, 'id' | 'recordedAt' | 'hlc' | 'hash'> => {
          counter += 1;
          return { id, recordedAt: at, hlc: nextHlc(at, counter, defaultNodeId), hash: null };
        };
        const values = Object.fromEntries(
          Object.entries(start).map(([name, value]) => [name, encodeEventValue(value)]),
        );
        const first = { ...base(), name: 'created', data: { values } };
        let inline: StorageRow = genericEvolve(entry, undefined, first);
        log.push({ name: first.name, data: first.data, hlc: first.hlc });
        for (const item of ops) {
          let name: string;
          let full: unknown;
          let stored: unknown;
          if (item.kind === 'update') {
            const ops = changedOpsOf(entry, inline, item.patch);
            name = 'changed';
            full = ops.full;
            stored = ops.stored;
          } else {
            name = item.kind === 'archive' ? 'archived' : 'restored';
            full = {};
            stored = {};
          }
          const event = { ...base(), name, data: full };
          inline = genericEvolve(entry, inline, event);
          log.push({ name, data: stored, hlc: event.hlc });
        }
        const stream = JSON.parse(JSON.stringify(log)) as typeof log;
        let rebuilt: StorageRow | undefined;
        for (const event of stream) {
          rebuilt = genericEvolve(entry, rebuilt, {
            id,
            name: event.name,
            data: event.data,
            recordedAt: at,
            hlc: event.hlc as EvolvingEvent['hlc'],
            hash: null,
          });
        }
        expect(rebuilt).toEqual(inline);
        expect(inline.version).toBe(log.length);
      }),
      { numRuns: 200 },
    );
  });

  test('a null clears an optional field and an increment adds to a counter', () => {
    const at = Temporal.Instant.from('2026-01-01T00:00:00Z');
    const row = genericEvolve(entry, undefined, {
      id: 'i',
      name: 'created',
      data: { values: { title: 't', count: 2, done: false, note: 'n' } },
      recordedAt: at,
      hlc: nextHlc(at, 1, defaultNodeId),
      hash: null,
    });
    const { full } = changedOpsOf(entry, row, { note: null, count: { inc: 3 } });
    const next = genericEvolve(entry, row, {
      id: 'i',
      name: 'changed',
      data: full,
      recordedAt: at,
      hlc: nextHlc(at, 2, defaultNodeId),
      hash: null,
    });
    expect(next.note).toBeUndefined();
    expect(next.count).toBe(5);
    expect(next.version).toBe(2);
  });
});
