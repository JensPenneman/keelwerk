import { describe, expect, test } from 'vitest';
import { latestTenantEntry } from './latest-tenant-entry.ts';

interface Entry {
  readonly type: string;
  readonly kind: string;
  readonly id: string;
  readonly at: string;
}

/** A control store whose tenant stream holds `entries`, numbered from 1, read the way an event store reads. */
function storeOf(entries: readonly Entry[]): { store: never; reads: () => number } {
  let reads = 0;
  const events = entries.map((entry, index) => ({
    version: index + 1,
    type: entry.type,
    actor: { kind: entry.kind, id: entry.id, via: 'socket' },
    recordedAt: Temporal.Instant.from(entry.at),
  }));
  const unit = {
    events: {
      readStream: async (
        _stream: unknown,
        range: { fromVersion?: number; toVersion?: number; limit?: number } = {},
      ) => {
        reads += events.length;
        return events
          .filter(
            (event) =>
              event.version >= (range.fromVersion ?? 1) &&
              event.version <= (range.toVersion ?? Number.MAX_SAFE_INTEGER),
          )
          .slice(0, range.limit ?? Number.MAX_SAFE_INTEGER);
      },
    },
  };
  return {
    store: { read: (fn: (u: typeof unit) => unknown) => fn(unit) } as never,
    reads: () => reads,
  };
}

const actor = { via: 'socket', id: 'op-1' };
const entered = (kind: string, id: string, at: string): Entry => ({
  type: 'core.tenant.entered',
  kind,
  id,
  at,
});

describe('latestTenantEntry', () => {
  test('is the latest entry of the same operator actor', async () => {
    const { store } = storeOf([
      entered('operator', 'op-1', '2026-11-05T08:00:00Z'),
      entered('operator', 'op-2', '2026-11-05T09:00:00Z'),
      entered('operator', 'op-1', '2026-11-05T09:30:00Z'),
    ]);
    expect((await latestTenantEntry(store, 't', actor))?.toString()).toBe('2026-11-05T09:30:00Z');
  });

  test('an entry whose actor is not an operator does not count, even with the same via and id', async () => {
    const { store } = storeOf([entered('user', 'op-1', '2026-11-05T08:00:00Z')]);
    expect(await latestTenantEntry(store, 't', actor)).toBeUndefined();
  });

  test('reads the newest events only: an entry buried under more than 200 events is not found', async () => {
    const filler: Entry[] = Array.from({ length: 200 }, () => ({
      type: 'core.tenant.updated',
      kind: 'operator',
      id: 'op-1',
      at: '2026-11-05T09:00:00Z',
    }));
    const buried = storeOf([entered('operator', 'op-1', '2026-11-05T08:00:00Z'), ...filler]);
    expect(await latestTenantEntry(buried.store, 't', actor)).toBeUndefined();
    const near = storeOf([entered('operator', 'op-1', '2026-11-05T08:00:00Z'), ...filler.slice(1)]);
    expect(await latestTenantEntry(near.store, 't', actor)).toBeDefined();
  });
});
