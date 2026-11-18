import { erasureKey, flagScrubCommandId } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { erasedEvents, flagRow, markers, targetFlag } from './support/erasure-helpers.ts';
import { bootProbe, type Probe } from './support/erasure-kit.ts';

let probe: Probe | undefined;
afterEach(async () => {
  await probe?.runtime.stop();
  probe = undefined;
});

const day = 24 * 60 * 60 * 1000;

async function person(tenant: ReturnType<Probe['as']>, name: string): Promise<string> {
  const made = (await tenant.invokeAs.invoke('probe.enrol', {
    name,
    email: `${name.toLowerCase()}.${crypto.randomUUID()}@example.test`,
    notes: `${name} ${markers.adaNotes}`,
  })) as { personId: string };
  return String(made.personId);
}

/** The control scope's receipt of the flag scrub of one erasure, by the id its identity gives. */
async function flagReceipt(
  p: Probe,
  erasure: { tenantId: string; commandId: string; subjectId: string },
) {
  const id = flagScrubCommandId(erasure);
  return p.runtime.control.adapter.unit(
    p.runtime.control.namespace,
    { level: 'deployment' },
    (unit) => unit.receipts.get(id),
    { readOnly: true },
  );
}

describe('an erasure is identified by its tenant, its command id and its subject', () => {
  test('two tenants and one tenant again use one command id for different subjects: every erasure runs, and each flag scrub', {
    timeout: 120_000,
  }, async () => {
    probe = await bootProbe('memory');
    const acme = probe.as('acme');
    const globex = probe.as('globex');
    const ada = await person(acme, 'Ada');
    const bea = await person(acme, 'Bea');
    const carol = await person(globex, 'Carol');
    const flagId = await targetFlag(probe, [ada, bea, carol], 'people');
    const commandId = 'erase-shared-command-id';
    const tenantIds = {
      acme: probe.runtime.tenants.acme.id,
      globex: probe.runtime.tenants.globex.id,
    };

    // Ada in acme, Carol in globex: the same command id in two tenants.
    await acme.eraseAsOperator(ada, { commandId });
    await probe.runtime.drainJobs();
    await probe.worker.pass();
    await globex.eraseAsOperator(carol, { commandId });
    await probe.runtime.drainJobs();
    await probe.worker.pass();
    expect((await globex.inTenant((unit) => unit.receipts.get(commandId)))?.status).toBe(
      'completed',
    );
    expect((await globex.rowsOf('probe.person')).map((row) => row.id)).toEqual([]);

    // Bea in acme, the same tenant and the same command id once the first receipt is gone.
    await probe.runtime.advanceTo(Temporal.Now.instant().add({ milliseconds: 3 * day }));
    await acme.eraseAsOperator(bea, { commandId });
    await probe.runtime.drainJobs();
    await probe.worker.pass();
    expect((await acme.inTenant((unit) => unit.receipts.get(commandId)))?.status).toBe('completed');
    expect((await acme.rowsOf('probe.person')).map((row) => row.id)).toEqual([]);

    // Each of the three erasures ran its own flag scrub, under an id of its own.
    const flag = await flagRow(probe, flagId);
    for (const subject of [ada, bea, carol]) {
      expect(JSON.stringify(flag?.targeting)).not.toContain(subject);
    }
    for (const [tenantId, subjectId] of [
      [tenantIds.acme, ada],
      [tenantIds.globex, carol],
      [tenantIds.acme, bea],
    ] as const) {
      expect(await flagReceipt(probe, { tenantId, commandId, subjectId })).toBeDefined();
    }

    // At the replay of a start (the epoch moved) every one of the three is run again, none is skipped
    // as a duplicate of another, and each ends with a completion of its own.
    const before = (await erasedEvents(probe)).length;
    await acme.bumpEpoch();
    await globex.bumpEpoch();
    const second = await probe.startWorker();
    expect(second.steps.filter((step) => step === 'completed')).toHaveLength(3);
    expect((await erasedEvents(probe)).length).toBe(before);
    const ledger = await probe.runtime.control.adapter.unit(
      probe.runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
      { readOnly: true },
    );
    const again = ledger.flatMap(({ record }) =>
      record.type === 'erasureCompleted' && record.epoch === 1
        ? [`${record.tenantId}:${record.subjectId}`]
        : [],
    );
    expect(again.sort()).toEqual(
      [
        `${tenantIds.acme}:${ada}`,
        `${tenantIds.globex}:${carol}`,
        `${tenantIds.acme}:${bea}`,
      ].sort(),
    );
  });

  test('a command id used again for the same subject in the other spelling is the same erasure', {
    timeout: 120_000,
  }, async () => {
    probe = await bootProbe('memory');
    const acme = probe.as('acme');
    const ada = await person(acme, 'Ada');
    await person(acme, 'Bea');
    const commandId = 'erase-spelling-command-id';
    await acme.eraseAsOperator(ada, { commandId });
    await probe.runtime.drainJobs();
    await probe.worker.pass();
    const records = async () =>
      (
        await probe?.runtime.control.adapter.unit(
          probe.runtime.control.namespace,
          { level: 'deployment' },
          (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
          { readOnly: true },
        )
      )?.flatMap(({ record }) => (record.type === 'erasure' ? [record] : [])) ?? [];
    expect(await records()).toHaveLength(1);
    // The first receipt is gone; the request comes again with the 32-digit spelling of the same subject.
    await probe.runtime.advanceTo(Temporal.Now.instant().add({ milliseconds: 3 * day }));
    await acme.eraseAsOperator(ada.replaceAll('-', ''), { commandId });
    await probe.runtime.drainJobs();
    await probe.worker.pass();
    const found = await records();
    expect(found).toHaveLength(1);
    expect(found[0]?.subjectId).toBe(ada);
    // One erasure has one identity under every spelling.
    const identity = { tenantId: probe.runtime.tenants.acme.id, commandId };
    expect(erasureKey({ ...identity, subjectId: ada })).toBe(
      erasureKey({ ...identity, subjectId: ada.replaceAll('-', '').toUpperCase() }),
    );
  });
});
