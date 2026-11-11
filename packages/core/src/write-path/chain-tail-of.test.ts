import { describe, expect, test } from 'vitest';
import type { StoredEvent } from '../events/stored-event.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { chainTailOf } from './chain-tail-of.ts';

const entry = { ref: 'core.effect' } as EntityEntry;

type Range = {
  readonly fromVersion?: number;
  readonly toVersion?: number;
  readonly limit?: number;
};

/** A unit whose store holds `versions` records of one stream, honours a range as the stores do, and records what it was asked. */
function recording(versions: number): { readonly unit: Unit; readonly asked: Range[] } {
  const asked: Range[] = [];
  const unit = {
    events: {
      readStream: (_stream: unknown, range: Range = {}) => {
        asked.push(range);
        const all = Array.from({ length: versions }, (_, index) => ({
          version: index + 1,
          hlc: `hlc-${index + 1}`,
          hash: index === 0 ? null : `hash-${index + 1}`,
        }));
        return Promise.resolve(
          all
            .filter(
              (event) =>
                event.version >= (range.fromVersion ?? 0) &&
                event.version <= (range.toVersion ?? Number.MAX_SAFE_INTEGER),
            )
            .slice(0, range.limit) as unknown as readonly StoredEvent[],
        );
      },
    },
  } as unknown as Unit;
  return { unit, asked };
}

describe('chainTailOf', () => {
  test('asks the store for exactly the record at the row version, never the whole stream', async () => {
    const { unit, asked } = recording(2);
    const tail = await chainTailOf(unit, entry, { id: 'e1', version: 2 });
    expect(asked).toEqual([{ fromVersion: 2, toVersion: 2, limit: 1 }]);
    expect(tail).toEqual({ kwLastHlc: 'hlc-2', kwLastHash: 'hash-2' });
  });

  test('a record without a hash gives the clock only', async () => {
    const { unit } = recording(1);
    expect(await chainTailOf(unit, entry, { id: 'e1', version: '1' })).toEqual({
      kwLastHlc: 'hlc-1',
    });
  });

  test('a row at version 2 whose stream ends at version 1 is internal, not the last record that is there', async () => {
    const { unit } = recording(1);
    await expect(chainTailOf(unit, entry, { id: 'e1', version: 2 })).rejects.toMatchObject({
      kind: 'internal',
      message: expect.stringContaining('no record at version 2'),
    });
  });
});
