import type { LiveView, StorageRow } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { BatchEarlier } from '../../src/hub/batch-earlier.ts';
import { changesOfBatch } from '../../src/hub/changes-of-batch.ts';
import type { ReaderBatch } from '../../src/hub/reader-batch.ts';
import { createVisibilitySet } from '../../src/hub/visibility-set.ts';

const key = 't.card A';

function viewOf(over: Partial<LiveView> = {}): LiveView {
  return {
    entity: 't.card',
    planKey: 'A',
    partition: undefined,
    includeArchived: false,
    inIds: () => true,
    inFilter: () => true,
    token: (position: bigint) => `tok${position}`,
    project: (row: StorageRow) => row,
    ...over,
  } as unknown as LiveView;
}

interface Change {
  readonly id: string;
  readonly at: bigint;
  /** The post-image; absent is a purged row. */
  readonly post?: StorageRow | undefined;
  /** What the plan shows of it; absent is outside the plan. */
  readonly shown?: StorageRow | undefined;
  readonly type?: string;
}

function batchOf(
  changes: readonly Change[],
  earlier: ReaderBatch['earlier'] = new Map(),
): ReaderBatch {
  return {
    from: 0n,
    to: 100n,
    events: changes.map((change) => ({
      position: change.at,
      stream: { type: 't.card', id: change.id },
      type: change.type ?? 't.card.changed',
      partition: null,
    })),
    rows: new Map([['t.card', new Map(changes.map((change) => [change.id, change.post]))]]),
    verdicts: new Map([
      [
        key,
        new Map(
          changes.flatMap((change) =>
            change.shown === undefined ? [] : [[change.id, change.shown]],
          ),
        ),
      ],
    ]),
    earlier,
  } as unknown as ReaderBatch;
}

const row = (id: string, over: Record<string, unknown> = {}): StorageRow => ({
  id,
  version: 2,
  ...over,
});

function partial() {
  const set = createVisibilitySet(10);
  set.markPartial();
  return set;
}

const asked = (ids: readonly string[], rows: readonly StorageRow[], uncertain = false) =>
  new Map<string, BatchEarlier>([
    [
      key,
      {
        asked: new Set(ids),
        earlier: { rows: new Map(rows.map((one) => [String(one.id), one])), uncertain },
      },
    ],
  ]);

describe('changesOfBatch', () => {
  test('a stream outside the ids is skipped: it is neither judged nor asked about', () => {
    const batch = batchOf([{ id: 'c9', at: 5n, post: row('c9'), shown: undefined }]);
    const changes = changesOfBatch({
      view: viewOf({ inIds: (id: string) => id !== 'c9' }),
      batch,
      set: partial(),
      floor: 0n,
    });
    expect(changes).toMatchObject({ items: [], unknown: [], uncertain: false });
  });

  test('a stream a partial set cannot place is unknown until its plan group was asked', () => {
    const batch = batchOf([{ id: 'c1', at: 5n, post: row('c1') }]);
    const changes = changesOfBatch({ view: viewOf(), batch, set: partial(), floor: 0n });
    expect(changes.unknown).toEqual(['c1']);
  });

  test('a stream the plan selected before the batch and does not show now is removed left-view', () => {
    const was = row('c1');
    const batch = batchOf([{ id: 'c1', at: 5n, post: row('c1') }], asked(['c1'], [was]));
    const changes = changesOfBatch({ view: viewOf(), batch, set: partial(), floor: 0n });
    expect(changes.items).toMatchObject([
      { event: { type: 'removed', id: 'c1', reason: 'left-view' } },
    ]);
    expect(changes.gone).toEqual(['c1']);
  });

  test("the subscriber's own filter decides on the earlier row: one it never held is not told", () => {
    const batch = batchOf([{ id: 'c1', at: 5n, post: row('c1') }], asked(['c1'], [row('c1')]));
    const changes = changesOfBatch({
      view: viewOf({ inFilter: () => false }),
      batch,
      set: partial(),
      floor: 0n,
    });
    expect(changes).toMatchObject({ items: [], unknown: [], uncertain: false });
  });

  test('an archived earlier row is not held by a subscriber that does not follow archived rows', () => {
    const was = row('c1', { archivedAt: '2026-11-01T00:00:00Z' });
    const batch = batchOf([{ id: 'c1', at: 5n, post: row('c1') }], asked(['c1'], [was]));
    expect(changesOfBatch({ view: viewOf(), batch, set: partial(), floor: 0n }).items).toEqual([]);
    expect(
      changesOfBatch({
        view: viewOf({ includeArchived: true }),
        batch,
        set: partial(),
        floor: 0n,
      }).items,
    ).toHaveLength(1);
  });

  test('an uncertain answer, or a stream that changed before the floor too, is uncertain', () => {
    const post = row('c1');
    const uncertain = batchOf([{ id: 'c1', at: 5n, post }], asked(['c1'], [], true));
    expect(
      changesOfBatch({ view: viewOf(), batch: uncertain, set: partial(), floor: 0n }).uncertain,
    ).toBe(true);
    // The group was asked for the state at the start of the batch, not at the floor.
    const early = batchOf(
      [
        { id: 'c1', at: 2n, post },
        { id: 'c1', at: 5n, post },
      ],
      asked(['c1'], [row('c1')]),
    );
    expect(
      changesOfBatch({ view: viewOf(), batch: early, set: partial(), floor: 3n }).uncertain,
    ).toBe(true);
  });

  test('a row that left the plan and was erased in one batch is told left-view; a selected erased row is erased', () => {
    const erased = row('c1', { kwErasedAt: '2026-11-11T00:00:00Z' });
    const set = createVisibilitySet(10);
    set.add('c1');
    set.add('c2');
    const batch = batchOf([
      // Outside the plan: nothing shown.
      { id: 'c1', at: 5n, post: erased },
      // Still selected by the plan, and erased.
      { id: 'c2', at: 6n, post: { ...erased, id: 'c2' }, shown: row('c2') },
      { id: 'c3', at: 7n, post: undefined },
    ]);
    set.add('c3');
    const reasons = changesOfBatch({ view: viewOf(), batch, set, floor: 0n }).items.map(
      (item) => (item.event as { reason?: string }).reason,
    );
    expect(reasons).toEqual(['left-view', 'erased', 'purged']);
  });
});
