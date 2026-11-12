import { describe, expect, test } from 'vitest';
import { currentEventSchemaVersion } from '../events/current-event-schema-version.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { LiveFilterGuard } from './live-filter-guard.ts';
import { pokesConcernOf } from './pokes-concern-of.ts';

const field = (over: object = {}) => ({ hidden: false, sealed: false, ...over });
const descriptor = {
  shape: { id: 'shape-current' },
  fields: {
    employeeId: field(),
    amount: field(),
    note: field({ hidden: { history: false } }),
  },
} as unknown as EntityDescriptor;

/** A guard that reads `{ op: 'eq', field, value }`. */
const guard: LiveFilterGuard = {
  check: () => Promise.resolve(),
  matches: (filter, row) => {
    const { field: name, value } = filter as unknown as { field: string; value: unknown };
    return row[name] === value;
  },
};
const mine = { op: 'eq', field: 'employeeId', value: 'me' } as never;

const event = (
  version: number,
  before: Record<string, unknown> | null,
  schemaVersion = currentEventSchemaVersion,
  shape = 'shape-current',
): StoredEvent => ({ version, before, schemaVersion, shape }) as unknown as StoredEvent;
const row = (employeeId: string): StorageRow => ({ id: 'r1', employeeId, amount: 1 }) as StorageRow;

describe('whether a batch of changes concerns a principal whose plan selects some rows', () => {
  const concerns = pokesConcernOf(guard, descriptor, mine);

  test('a row of the plan after the batch concerns it', () => {
    expect(concerns([{ row: row('me'), events: [event(2, { amount: 0 })] }])).toBe(true);
  });

  test("another's row, changed or created, concerns nobody here", () => {
    expect(concerns([{ row: row('hr'), events: [event(2, { amount: 0 })] }])).toBe(false);
    expect(concerns([{ row: row('hr'), events: [event(1, null)] }])).toBe(false);
    expect(concerns([{ row: row('hr'), events: [event(2, null), event(3, null)] }])).toBe(false);
  });

  test('a row that left the plan in the batch concerns it', () => {
    expect(concerns([{ row: row('hr'), events: [event(2, { employeeId: 'me' })] }])).toBe(true);
    // Moved twice in one batch: it was mine before the first move.
    expect(
      concerns([
        {
          row: row('zed'),
          events: [event(2, { employeeId: 'me' }), event(3, { employeeId: 'hr' })],
        },
      ]),
    ).toBe(true);
    expect(
      concerns([
        {
          row: row('zed'),
          events: [event(2, { employeeId: 'hr' }), event(3, { employeeId: 'zed' })],
        },
      ]),
    ).toBe(false);
  });

  test('one change among others is enough', () => {
    expect(
      concerns([
        { row: row('hr'), events: [event(2, null)] },
        { row: row('me'), events: [event(2, null)] },
      ]),
    ).toBe(true);
  });

  test('what cannot be decided in memory concerns the principal', () => {
    // A purged row has no post-image.
    expect(concerns([{ row: undefined, events: [event(2, null)] }])).toBe(true);
    // A before-image in another form than the row's.
    expect(concerns([{ row: row('hr'), events: [event(2, { employeeId: { at: 'x' } })] }])).toBe(
      true,
    );
    // A plan that reads a hidden field: its before-image is not kept.
    const hidden = pokesConcernOf(guard, descriptor, {
      op: 'eq',
      field: 'note',
      value: 'x',
    } as never);
    expect(hidden([{ row: row('hr'), events: [event(2, null)] }])).toBe(true);
  });

  test('an event of another shape concerns it: a rename is recorded in the shape, not the schema version', () => {
    // The older build of a rolling deploy stored the move under the old name `owner`, with the current schema version.
    const renamed = event(2, { owner: 'me' }, currentEventSchemaVersion, 'shape-before-rename');
    expect(concerns([{ row: row('hr'), events: [renamed] }])).toBe(true);
  });

  test('an event of an older schema version concerns it: its before-image has the old names', () => {
    // A module declared another schema version; the old build stored the move under the old name.
    const older = event(2, { owner: 'me' }, currentEventSchemaVersion - 1);
    expect(concerns([{ row: row('hr'), events: [older] }])).toBe(true);
    // The same move stored by the current build is told from its before-image.
    expect(concerns([{ row: row('hr'), events: [event(2, { amount: 0 })] }])).toBe(false);
  });
});
