import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { commandReceiptUuid } from '@keelwerk/core';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { erasedEvents, seed } from './support/erasure-helpers.ts';
import { bootProbe, type Probe } from './support/erasure-kit.ts';

describe('two workers on one erasure on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let probe: Probe;

  beforeAll(async () => {
    postgres = await startPostgres({ checkDeadlocks: true });
    probe = await bootProbe('memory', {
      external: {
        factory: postgresAdapter({ ownerUrl: postgres.adminUrl }),
        url: postgres.appUrl,
      },
    });
  }, 180_000);

  afterAll(async () => {
    await probe?.runtime.stop();
    await postgres?.stop();
  });

  test('give the result of one: one erased event per stream, one completed receipt, one change record', {
    timeout: 120_000,
  }, async () => {
    const ids = await seed(probe);
    const { commandId } = await probe.eraseAsOperator(ids.adaId);
    await probe.runtime.drainJobs();
    // The first worker's pass and a second worker's start pass run the one record at once.
    await Promise.all([probe.worker.pass(), probe.startWorker()]);
    const receipt = await probe.inTenant((unit) => unit.receipts.get(commandId));
    expect(receipt?.status).toBe('completed');
    expect(receipt?.outcome).toMatchObject({ ok: true, value: { streams: 3 } });
    const events = await erasedEvents(probe);
    expect(events).toHaveLength(3);
    expect(new Set(events.map((event) => `${event.stream.type}/${event.stream.id}`)).size).toBe(3);
    const changes = await probe.inTenant((unit) =>
      unit.events.readStream({
        type: 'core.commandReceipt',
        id: commandReceiptUuid(probe.runtime.tenants.acme.id, commandId),
      }),
    );
    expect(changes.filter((event) => event.type.endsWith('.changed'))).toHaveLength(1);
    expect((await probe.rowsOf('probe.person')).map((row) => row.id)).toEqual([ids.beaId]);
  });
});
