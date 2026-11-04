// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import { isKeelwerkError } from '@keelwerk/core';
import { CompiledQuery } from 'kysely';
import { describe, expect, test } from 'vitest';
import { streamAppend } from './support/event-fixtures.ts';
import { eventHarness } from './support/event-harness.ts';
import { ticket } from './support/store-entities.ts';
import { id, row } from './support/store-rows.ts';
import { taggedUnit } from './support/tagged-unit.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA, tenantA } = testScopes;
const { run, failure, adapter, clock, owner } = eventHarness('event_store', 6);

const conflict = { kind: 'conflict', code: 'core.version_mismatch' };

/** Resolves once `count` callers have arrived: the point where concurrent units have all read before any commits. */
function barrier(count: number): () => Promise<void> {
  let arrived = 0;
  const release: { open?: () => void } = {};
  const opened = new Promise<void>((resolve) => {
    release.open = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === count) release.open?.();
    await opened;
  };
}

const eventsOf = (): Promise<readonly [string, number][]> =>
  owner(async (client) =>
    (
      await client.query<{ stream_id: string; position: string }>(
        'select stream_id, position::text from app.kw_events order by position',
      )
    ).rows.map((found) => [found.stream_id, Number(found.position)] as [string, number]),
  );

describe('expected versions on PostgreSQL', () => {
  test('two units that read the same version: one commits, the other is a version conflict at its tail', async () => {
    const gate = barrier(2);
    const writer = (n: number): Promise<unknown> =>
      run(scopeA, async (u) => {
        await u.events.append([streamAppend(1, [n])]);
        await gate();
      });
    const outcomes = await Promise.allSettled([writer(1), writer(2)]);
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await failure(Promise.reject(rejected[0]?.reason))).toEqual(conflict);
    expect(await eventsOf()).toEqual([[id(1), 1]]);
    expect(await run(scopeA, (u) => u.events.head())).toBe(1n);
  });

  test('a batch over several streams is atomic: a stream another unit took first leaves none of them', async () => {
    const outcome = await failure(
      run(scopeA, async (u) => {
        await u.events.append([streamAppend(1, [1]), streamAppend(2, [2])]);
        await adapter().unit(testNamespace, scopeA, async (other) =>
          other.events.append([streamAppend(2, [3])]),
        );
      }),
    );
    expect(outcome).toEqual(conflict);
    expect(await eventsOf()).toEqual([[id(2), 1]]);
    expect(await run(scopeA, (u) => u.events.head())).toBe(1n);
  });

  test('the conflict names the one stream another unit took first, although row-level security hides the violation detail', async () => {
    const error = await run(scopeA, async (u) => {
      await u.events.append([streamAppend(1, [1]), streamAppend(2, [2])]);
      await adapter().unit(testNamespace, scopeA, async (other) =>
        other.events.append([streamAppend(2, [3])]),
      );
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(isKeelwerkError(error) && error.details).toEqual({
      stream: { type: 'app.ticket', id: id(2) },
    });
    expect(await eventsOf()).toEqual([[id(2), 1]]);
  });

  test('a stream continues from its committed version, and a stale expectation is refused before the tail', async () => {
    await run(scopeA, (u) => u.events.append([streamAppend(1, [1, 2])]));
    expect(await failure(run(scopeA, (u) => u.events.append([streamAppend(1, [3], 1)])))).toEqual(
      conflict,
    );
    const results = await run(scopeA, (u) => u.events.append([streamAppend(1, [3], 2)]));
    expect(results.map((result) => result.version)).toEqual([3]);
    const stored = await run(scopeA, (u) => u.events.readStream({ type: 'app.ticket', id: id(1) }));
    expect(stored.map((event) => [event.version, event.position])).toEqual([
      [1, 1n],
      [2, 2n],
      [3, 3n],
    ]);
  });
});

describe('a locked load records the position of the row it returns (decision 109)', () => {
  async function waitForLockWaiter(): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const waiting = await owner(async (client) =>
        client.query(
          `select 1 from pg_stat_activity
           where datname = current_database() and application_name = 'kwtest:reader'
             and wait_event_type = 'Lock' and state = 'active'`,
        ),
      );
      if (waiting.rowCount !== 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('no unit waited for the row lock');
  }

  /**
   * A writer holds the row's lock and, once a reader waits on it, appends an event, bumps the row
   * and commits. `read` starts while the lock is held and answers the position it recorded for the
   * row it got; `own` is the position of the row's last event.
   */
  async function lockWait(read: () => Promise<bigint>): Promise<{ recorded: bigint; own: bigint }> {
    await run(scopeA, async (u) => {
      await u.rows.insert(ticket, [row(1, { title: 'hot' })]);
      await u.events.append([streamAppend(1, [1])]);
    });
    const held: { release: () => void } = { release: () => undefined };
    const holding = new Promise<void>((resolve) => {
      held.release = resolve;
    });
    const writer = run(scopeA, async (u) => {
      await u.rows.lock?.(ticket, {}, { mode: 'update' });
      held.release();
      await waitForLockWaiter();
      await u.events.append([streamAppend(1, [2], 1)]);
      await u.rows.update(ticket, [
        { id: id(1), expectedVersion: 1, values: row(1, { version: 2, title: 'hot' }) },
      ]);
    });
    await holding;
    const reader = read();
    await writer;
    const recorded = await reader;
    const stored = await run(scopeA, (u) => u.events.readStream({ type: 'app.ticket', id: id(1) }));
    return { recorded, own: stored.at(-1)?.position ?? 0n };
  }

  test('the position read after the lock is the one the row was written at', async () => {
    const seen = await lockWait(async () =>
      taggedUnit(adapter(), clock, scopeA, 'reader', async (u) => {
        const locked = await u.rows.lock?.(ticket, {}, { mode: 'update' });
        expect(locked?.[0]?.version).toBe(2);
        return (await u.events.head()) ?? 0n;
      }),
    );
    expect(seen).toEqual({ recorded: 2n, own: 2n });
  });

  test('a position carried by the locking statement is the stale snapshot the specification forbids', async () => {
    const seen = await lockWait(async () =>
      adapter().session(testNamespace, scopeA, async (session) => {
        await session.db.executeQuery(
          CompiledQuery.raw(`select set_config('application_name', 'kwtest:reader', true)`),
        );
        const result = await session.db.executeQuery<{ at: string; version: string }>(
          CompiledQuery.raw(
            `select version::text, (select next - 1 from app.kw_positions where scope_id = $1)::text as at
             from app.app__ticket where tenant_id = $1 for update`,
            [tenantA],
          ),
        );
        expect(result.rows[0]?.version).toBe('2');
        return BigInt(result.rows[0]?.at ?? '0');
      }),
    );
    expect(seen).toEqual({ recorded: 1n, own: 2n });
  });
});
