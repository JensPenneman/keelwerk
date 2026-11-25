import { describe, expect, test } from 'vitest';
import { controlReaderOf } from '../../src/doctor/control-reader-of.ts';
import { doctorReadBounds } from '../../src/doctor/doctor-read-bounds.ts';

const { pageBudget, pageSize } = doctorReadBounds;
const now = Temporal.Instant.from('2026-11-24T10:00:00Z');
const tooMany = `more than ${pageBudget * pageSize} rows`;

/** A reader whose one unit is `unit`: the source hands it to every read. */
function readerOver(unit: object) {
  return controlReaderOf(
    {
      read: async (fn: (unit: never, entity: (ref: string) => never) => Promise<unknown>) =>
        fn(unit as never, (ref: string) => ({ ref }) as never),
    } as never,
    () => now,
  );
}

const row = (id: string) => ({ id, name: id, roles: ['serve'], state: 'ready', heartbeatAt: now });

describe('the processes the reader lists', () => {
  test('asks for the processes that are not stopped, by id, a page at a time, and follows the cursor', async () => {
    const asked: unknown[] = [];
    const pages = [
      { rows: [row('a'), row('b')], pageInfo: { hasNextPage: true, endCursor: 'c1' } },
      { rows: [row('c')], pageInfo: { hasNextPage: false, endCursor: 'c2' } },
    ];
    const reader = readerOver({
      rows: {
        find: async (_entity: unknown, query: unknown) => {
          asked.push(query);
          return pages[asked.length - 1];
        },
      },
    });
    expect((await reader.processes()).map((process) => process.id)).toEqual(['a', 'b', 'c']);
    expect(asked).toEqual([
      {
        where: { op: 'ne', field: 'state', value: 'stopped' },
        sort: [{ field: 'id', direction: 'asc' }],
        page: { first: pageSize },
      },
      {
        where: { op: 'ne', field: 'state', value: 'stopped' },
        sort: [{ field: 'id', direction: 'asc' }],
        page: { first: pageSize, after: 'c1' },
      },
    ]);
  });

  test('a store with more pages than the budget gives no list', async () => {
    let reads = 0;
    const reader = readerOver({
      rows: {
        find: async () => {
          reads += 1;
          return { rows: [row('a')], pageInfo: { hasNextPage: true, endCursor: `c${reads}` } };
        },
      },
    });
    await expect(reader.processes()).rejects.toThrow(tooMany);
    expect(reads).toBe(pageBudget);
  });
});

describe('a page that says more follows', () => {
  test('and gives no cursor is a failed read, never a complete list', async () => {
    const reader = readerOver({
      rows: {
        find: async () => ({ rows: [row('a')], pageInfo: { hasNextPage: true, endCursor: null } }),
      },
    });
    await expect(reader.processes()).rejects.toThrow('gave no cursor');
  });
});

describe('the failed hooks the reader lists', () => {
  /** A log whose scope head is `head`: it answers one page with the events it was given and records what it was asked. */
  function logOf(head: bigint | null, events: readonly { type: string; tenant: string }[]) {
    const asked: { after: unknown; selector: unknown }[] = [];
    return {
      asked,
      reader: readerOver({
        events: {
          head: async () => head,
          readAll: async (after: unknown, options: { selector: unknown }) => {
            asked.push({ after, selector: options.selector });
            return {
              events: events.map((event) => ({
                type: event.type,
                stream: { id: event.tenant },
                data: { hook: 'billing.onTenantCreated' },
              })),
              next: null,
            };
          },
        },
      }),
    };
  }
  const failed = { type: 'core.tenant.hookFailed', tenant: 't1' };

  test('asks for the two outcome events only, and reads a log within the window from its start', async () => {
    const { asked, reader } = logOf(10n, [failed]);
    expect(await reader.hookFailures()).toEqual({
      failures: [{ hookId: 'billing.onTenantCreated', tenantId: 't1' }],
      olderUnread: false,
    });
    expect(asked).toEqual([
      {
        after: null,
        selector: {
          streamTypes: ['core.tenant'],
          names: ['core.tenant.hookFailed', 'core.tenant.hookCompleted'],
        },
      },
    ]);
  });

  test('a log that grew past the window is read from the newest window and says that older outcomes were not read', async () => {
    const window = BigInt(pageBudget * pageSize);
    const { asked, reader } = logOf(window + 7n, [failed]);
    expect(await reader.hookFailures()).toMatchObject({ olderUnread: true });
    expect(asked[0]?.after).toBe(7n);
  });

  test('a log at the edge of the window is read whole', async () => {
    const { asked, reader } = logOf(BigInt(pageBudget * pageSize), [failed]);
    expect(await reader.hookFailures()).toMatchObject({ olderUnread: false });
    expect(asked[0]?.after).toBeNull();
  });

  test('a log with more pages than the budget gives no list', async () => {
    let reads = 0;
    const reader = readerOver({
      events: {
        head: async () => null,
        readAll: async () => {
          reads += 1;
          return { events: [{ type: 'x', stream: { id: 't' }, data: null }], next: `p${reads}` };
        },
      },
    });
    await expect(reader.hookFailures()).rejects.toThrow(tooMany);
    expect(reads).toBe(pageBudget);
  });
});

describe('the held tenants the reader lists', () => {
  test('a ledger with more full pages than the budget gives no list', async () => {
    let reads = 0;
    const reader = readerOver({
      marks: { bumped: async () => [] },
      ledger: {
        unfinished: async () => {
          reads += 1;
          return {
            erasures: Array.from({ length: pageSize }, (_, index) => ({
              seq: BigInt(reads * pageSize + index),
              record: { tenantId: 't' },
            })),
          };
        },
      },
    });
    await expect(reader.heldTenants()).rejects.toThrow(tooMany);
    expect(reads).toBe(pageBudget);
  });
});
