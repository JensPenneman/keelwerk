import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { reactionJob, reactionsInModuleOrder } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { jobSpy } from './support/job-spy.ts';
import { bootReactions, tenantEventsOf } from './support/reactions-kit.ts';
import { relayApp } from './support/relay-app.ts';

const kits: Awaited<ReturnType<typeof bootReactions>>[] = [];
afterAll(async () => {
  await Promise.allSettled(kits.map((kit) => kit.stop()));
});

describe('the reaction dispatcher over one PostgreSQL database', () => {
  test('two runtimes dispatch and run each (reaction, event) once, also for a second job copy', {
    timeout: 180_000,
  }, async () => {
    const database = await createTestDatabase('reactions_two_processes');
    const descriptors = new Map(
      [...relayApp.registry.entities].map(([ref, entry]) => [ref, entry.descriptor] as const),
    );
    // The completions of every job of both processes, as the store answered them.
    const watched = jobSpy(
      (ref) => descriptors.get(ref),
      postgresAdapter({ ownerUrl: database.adminUrl }),
    );
    const external = { factory: watched.factory, url: database.appUrl };
    const first = await bootReactions({ external });
    kits.push(first);
    const second = await bootReactions({
      external,
      join: {
        backendId: first.runtime.backendId,
        tenants: { acme: first.runtime.tenants.acme.id, globex: first.runtime.tenants.globex.id },
      },
    });
    kits.push(second);
    const both = async () => {
      await first.settle();
      await second.settle();
      await first.settle();
    };
    const answered = async () =>
      (await first.rows('acme', 'relay.echo')).map((row) => `${row.reaction}:${row.signal}`);

    const one = await first.send('acme', { channel: 'one' });
    if (!one.ok) throw one.error;
    await both();
    // Sent through the other process, dispatched by whichever holds the lease: still once each.
    const two = await second.send('acme', { channel: 'two' });
    if (!two.ok) throw two.error;
    await both();
    const rows = await answered();
    expect(rows.filter((row) => row.endsWith(one.value.signalId))).toHaveLength(6);
    expect(rows.filter((row) => row.endsWith(two.value.signalId))).toHaveLength(6);
    expect(new Set(rows).size).toBe(rows.length);

    // Two copies of one (reaction, event) job, one per process and with no key, so neither is folded
    // into the other: both run in the two processes while the first still holds the receipt row, and
    // the receipt lets only one decide.
    const created = (await tenantEventsOf(first, 'acme')).find(
      (event) => event.type === 'relay.signal.created' && event.stream.id === one.value.signalId,
    );
    const reaction = reactionsInModuleOrder(first.runtime.app.registry, 'async').find(
      (one) => one.id === 'relay.echo',
    );
    if (created === undefined || reaction === undefined) throw new Error('fixture is incomplete');
    const { key: _key, ...copy } = reactionJob({
      reaction,
      event: created,
      declaredKey: undefined,
      build: { id: 'test-build', revision: 1 },
      now: first.now(),
    });
    const { spy } = watched;
    const before = spy.completions.length;
    const takesBefore = spy.takes.length;
    const enqueue = (kit: typeof first) =>
      kit.runtime.adapter.unit(kit.runtime.namespace, kit.scopeOf('acme'), (unit) =>
        unit.jobs.enqueue({ ...copy, kind: 'action', laneCap: 4, createdAt: kit.now() }),
      );
    // The first copy is held at a door once it has taken the receipt row. The worker that took it
    // takes nothing more, so the second copy can only be taken by the other process; the door opens
    // when that process asks for the same receipt, which waits on the row the first copy holds.
    const claims = new Map<string, number>();
    const waiting = Promise.withResolvers<void>();
    const atDoor = Promise.withResolvers<void>();
    spy.beforeReceiptClaim = (commandId) => {
      const count = (claims.get(commandId) ?? 0) + 1;
      claims.set(commandId, count);
      if (count === 2) waiting.resolve();
    };
    let held = false;
    spy.afterReceiptComplete = async () => {
      if (held) return;
      held = true;
      atDoor.resolve();
      await waiting.promise;
    };
    await enqueue(first);
    const draining = first.runtime.drainJobs();
    await atDoor.promise;
    const holder = spy.takes.slice(takesBefore).find((take) => take.jobs.length > 0)?.worker;
    if (holder === undefined) throw new Error('no worker took the first copy');
    spy.refuseTake = (queue, worker) => queue === 'reactions' && worker === holder;
    await enqueue(second);
    await Promise.all([draining, first.settle(), second.settle()]);
    spy.refuseTake = undefined;
    spy.beforeReceiptClaim = undefined;
    spy.afterReceiptComplete = undefined;
    const copies = spy.completions.slice(before);
    expect(copies.map((completion) => completion.outcome.kind)).toEqual(['succeeded', 'succeeded']);
    expect(new Set(copies.map((completion) => completion.worker)).size).toBe(2);
    expect(copies.every((completion) => completion.granted)).toBe(true);
    expect(await answered()).toHaveLength(rows.length);
    for (const kit of [first, second]) {
      const stats = await kit.runtime.adapter.unit(
        kit.runtime.namespace,
        kit.scopeOf('acme'),
        (unit) => unit.jobs.stats('reactions'),
        { readOnly: true },
      );
      expect(stats.reduce((total, row) => total + row.due + row.running, 0)).toBe(0);
    }
  });
});
