import { describe, expect, test } from 'vitest';
import { noteEvent, reactionRegistry } from '../../test/reaction-kit.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { asyncReactionEventOf } from './async-reaction-event-of.ts';

const registry = reactionRegistry();
const stored = noteEvent();

/** A unit whose entity rows are `row`, counting the reads. */
function unitWith(row: StorageRow | undefined) {
  const reads: unknown[] = [];
  const unit = {
    rows: {
      findOne: (_descriptor: unknown, query: unknown) => {
        reads.push(query);
        return Promise.resolve(row);
      },
    },
  } as unknown as Unit;
  return { unit, reads };
}
const row = (over: Record<string, unknown> = {}): StorageRow =>
  ({
    id: stored.stream.id,
    version: 3n,
    owner: 'ada',
    text: 'now',
    kwLastHash: 'hidden-chain-state',
    ...over,
  }) as unknown as StorageRow;

describe('the event as an async reaction sees it', () => {
  test('carries the event members and the row as it is when the job runs, in the view of the module', async () => {
    const { unit, reads } = unitWith(row());
    const event = await asyncReactionEventOf(unit, registry, 'logs', stored);
    expect(event).toMatchObject({
      id: stored.eventId,
      type: 'logs.note.created',
      stream: stored.stream,
      version: 1,
      position: 7n,
      data: { values: { text: 'hello' } },
      before: null,
      actor: stored.actor,
      commandId: 'cmd-1',
      causationId: null,
      at: stored.recordedAt,
    });
    // `current` is the row now (text 'now', not the event's 'hello'), without the chain state of the kernel.
    expect(event.current).toMatchObject({ text: 'now', owner: 'ada' });
    expect(event.current).not.toHaveProperty('kwLastHash');
    expect(reads).toEqual([
      { where: { op: 'eq', field: 'id', value: stored.stream.id }, includeArchived: true },
    ]);
  });

  test('current is undefined when the row is gone, erased, or the stream is no entity', async () => {
    expect(
      (await asyncReactionEventOf(unitWith(undefined).unit, registry, 'logs', stored)).current,
    ).toBeUndefined();
    const erased = row({ kwErasedAt: Temporal.Instant.from('2026-03-02T00:00:00Z') });
    expect(
      (await asyncReactionEventOf(unitWith(erased).unit, registry, 'logs', stored)).current,
    ).toBeUndefined();
    const other = noteEvent({ stream: { type: 'logs.tally', id: 'x' }, type: 'logs.tally.noted' });
    const { unit, reads } = unitWith(row());
    expect((await asyncReactionEventOf(unit, registry, 'logs', other)).current).toBeUndefined();
    expect(reads).toEqual([]);
  });
});
