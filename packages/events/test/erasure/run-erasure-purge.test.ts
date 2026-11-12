import { afterEach, describe, expect, test } from 'vitest';
import { finish, seed } from './support/erasure-helpers.ts';
import { bootProbe, type Probe } from './support/erasure-kit.ts';

let probe: Probe | undefined;
afterEach(async () => {
  await probe?.runtime.stop();
  probe = undefined;
});

describe('step 5a purges what belongs to the subject and nothing of another subject', () => {
  const receiptOf = (p: Probe, commandId: string) =>
    p.inTenant((unit) => unit.receipts.get(commandId));
  const person = async (p: Probe, name: string, email: string): Promise<string> =>
    String(
      ((await p.invokeAs.invoke('probe.enrol', { name, email })) as { personId: string }).personId,
    );

  test("the receipt of another subject's own command survives, and the same command id answers the first run", {
    timeout: 60_000,
  }, async () => {
    probe = await bootProbe();
    const adaId = await person(probe, 'Ada', 'a@example.test');
    const beaId = await person(probe, 'Bea', 'b@example.test');
    const openId = crypto.randomUUID();
    const input = { ownerId: beaId as never, title: 'b', topic: 'bea topic' };
    const opened = (await probe.invokeAs.invoke('probe.open', input, {
      commandId: openId,
    })) as { threadId: string };
    // Ada replies on Bea's thread, so Bea's thread is one of Ada's streams.
    await probe.invokeAs.invoke('probe.answer', {
      threadId: opened.threadId as never,
      replierId: adaId as never,
      reply: 'ada reply',
    });
    await probe.eraseAsOperator(adaId);
    await finish(probe);
    expect((await receiptOf(probe, openId))?.status).toBe('completed');
    const again = (await probe.invokeAs.invoke('probe.open', input, {
      commandId: openId,
    })) as { threadId: string };
    expect(again.threadId).toBe(opened.threadId);
    expect((await probe.rowsOf('probe.thread')).length).toBe(1);
  });

  test('erasing a second subject keeps the completed receipt of the first erasure', {
    timeout: 60_000,
  }, async () => {
    probe = await bootProbe();
    const ids = await seed(probe);
    // Bea's erasure event sits in Ada's thread, which Ada owns.
    const first = await probe.eraseAsOperator(ids.beaId);
    await finish(probe);
    const second = await probe.eraseAsOperator(ids.adaId);
    await finish(probe);
    expect((await receiptOf(probe, first.commandId))?.status).toBe('completed');
    expect((await receiptOf(probe, second.commandId))?.status).toBe('completed');
  });

  test('a second erasure of the same subject keeps the receipt of the first', {
    timeout: 60_000,
  }, async () => {
    probe = await bootProbe();
    const ids = await seed(probe);
    const first = await probe.eraseAsOperator(ids.adaId);
    await finish(probe);
    const second = await probe.eraseAsOperator(ids.adaId);
    await finish(probe);
    expect((await receiptOf(probe, first.commandId))?.status).toBe('completed');
    expect((await receiptOf(probe, second.commandId))?.status).toBe('completed');
  });

  test("a row that only holds the subject's value is not owned: the jobs of its id are kept", {
    timeout: 60_000,
  }, async () => {
    probe = await bootProbe();
    const adaId = await person(probe, 'Ada', 'a@example.test');
    const beaId = await person(probe, 'Bea', 'b@example.test');
    // Bea's row holds Ada's note, so it is one of Ada's streams, and its id is Bea's principal id.
    await probe.invokeAs.invoke('probe.befriend', {
      personId: beaId as never,
      friendId: adaId as never,
      note: 'ada note on bea',
    });
    const p = probe;
    const queued = (id: string) =>
      p.inTenant((unit) =>
        unit.jobs.enqueue({
          queue: 'commands',
          run: { action: 'probe.open', input: {} },
          scope: {
            level: 'tenant',
            backendId: p.runtime.backendId,
            tenantId: p.runtime.tenants.acme?.id ?? '',
          },
          principal: { resolver: 'test', principalId: id },
          causation: {},
          build: { id: 'b', revision: 1 },
          kind: 'action',
          laneCap: 10,
          createdAt: Temporal.Now.instant(),
          runAt: Temporal.Now.instant().add({ hours: 1 }),
        }),
      );
    await queued(beaId);
    await queued(adaId);
    const count = async (): Promise<number> =>
      (await p.inTenant((unit) => unit.jobs.stats('commands'))).reduce(
        (total, row) => total + row.queued,
        0,
      );
    expect(await count()).toBe(2);
    await probe.eraseAsOperator(adaId);
    await finish(probe);
    // Ada's job is purged; Bea's is not, though her row was one of the streams that were erased.
    expect(await count()).toBe(1);
    const people = await probe.rowsOf('probe.person');
    expect(people.map((row) => row.id)).toEqual([beaId]);
    expect(people[0]?.friendNote).toBeUndefined();
  });
});
