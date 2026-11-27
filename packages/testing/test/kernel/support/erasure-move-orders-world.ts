import type { ErasureRecord, ErasureStep, LedgerRecord, Scope } from '@keelwerk/core';
import { createControlLedger } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import { chainApp } from './erasure-chain-app.ts';
import { watchedSink } from './watched-sink.ts';

const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

/** The runtime of the search, its worker with the hooks an order hangs its actions on, and what an order reads back. */
export async function bootWorld() {
  const records: LedgerRecord[] = [];
  /** The clock only the test moves, by `tick`: a read never moves it, so what a run does cannot depend on how long it takes. */
  let now = Temporal.Instant.from('2026-11-26T12:00:00Z');
  const clock = { now: () => now };
  const live = {
    during: async (_step: ErasureStep, _record: ErasureRecord) => {},
    atSink: async (_batch: number, _records: readonly LedgerRecord[]) => {},
    /** A sink that is down for a batch throws before it takes it: nothing of the batch is kept. */
    refuse: (_records: readonly LedgerRecord[]) => false as boolean,
    batches: 0,
  };
  const sink = watchedSink(async (batch) => {
    if (live.refuse(batch)) throw new Error('the sink is down');
    records.push(...batch);
    // The anchor writer appends the heads of the scopes on its own cadence, at moments the erasure does not decide: only the records the erasure writes count and trigger.
    const own = batch.filter((record) => record.type !== 'anchor');
    if (own.length > 0) await live.atSink(live.batches++, own);
  });
  const worker = erasure({
    pollMs: 3_600_000,
    afterStep: (step, record) => live.during(step, record),
  });
  const runtime = await startTestRuntime(chainApp, {
    adapter: 'memory',
    clock,
    operators: true,
    workers: true,
    tenants: ['acme'],
    eventWorkers: [worker],
    ledgers: [sink],
  });
  const scope: Scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const inUnit = <T>(
    fn: (unit: Parameters<Parameters<typeof runtime.adapter.unit>[2]>[0]) => Promise<T>,
  ) => runtime.adapter.unit(runtime.namespace, scope, fn);
  const rowOf = (kind: string, id: string) =>
    inUnit(async (unit) => {
      const descriptor = runtime.app.registry.entities.get(`chain.${kind}`)?.descriptor;
      if (descriptor === undefined) throw new Error(`no entity ${kind}`);
      return (
        await unit.rows.find(descriptor, { includeArchived: true, includeErased: true })
      ).rows.find((row) => row.id === id);
    });
  const tick = () => {
    now = now.add({ seconds: 2 });
  };
  const make = async (kind: string, link: string, secret?: string): Promise<string> => {
    tick();
    const input = { kind, link, ...(secret === undefined ? {} : { secret }) };
    return String(((await operator.invoke('chain.make', input as never)) as { id: string }).id);
  };
  /** The rows of one subject, from the root of the path down to the owned row. */
  const chainOf = async (depth: number, owner: string): Promise<string[]> => {
    if (depth === 1) return [await make('parcel', owner, `${owner} secret`)];
    const holder = await make(depth === 2 ? 'holder2' : 'holder3', owner);
    if (depth === 2) return [holder, await make('item2', holder, `${owner} secret`)];
    const box = await make('box3', holder);
    return [holder, box, await make('item3', box, `${owner} secret`)];
  };
  const makeMemo = async (aboutId: string, otherId: string, owner?: string): Promise<string> => {
    tick();
    const input = {
      aboutId,
      otherId,
      secret: 'memo secret',
      ...(owner === undefined ? {} : { owner }),
    };
    return String(((await operator.invoke('chain.makeMemo', input as never)) as { id: string }).id);
  };
  /** A deed that holds a value of `aboutId`, owned through a holder that nobody owns. */
  const makeDeed = async (aboutId: string): Promise<{ id: string; holderId: string }> => {
    tick();
    const input = { aboutId, secret: 'deed secret' };
    return (await operator.invoke('chain.makeDeed', input as never)) as never;
  };
  const makePledge = async (email: string): Promise<string> => {
    tick();
    return String(
      ((await operator.invoke('chain.makePledge', { email } as never)) as { id: string }).id,
    );
  };
  const change = (
    kind: string,
    id: string,
    patch: { link?: string; secret?: string; clear?: boolean },
  ) => {
    tick();
    return operator.attempt('chain.change', { kind, id, ...patch } as never);
  };
  /**
   * Gives the deed's holder to `subject` once the deed's value of hers is cleared (the erasure has
   * answered the deed as a mere holder, and her keys are not destroyed yet): whether it did.
   */
  const handHolder = async (deed: { id: string; holderId: string }, subject: string) => {
    if ((await rowOf('deed', deed.id))?.about != null) return false;
    await change('holder4', deed.holderId, { link: subject });
    return true;
  };
  const control = createControlLedger(runtime.control.adapter, runtime.control.namespace);
  /** A tombstone in the control ledger, as another erasure (`commandId`) or an earlier pass of this one leaves it. */
  const tombstone = async (keyId: string, commandId?: string) => {
    tick();
    await control.append({
      type: 'keyTombstone',
      scopeId: runtime.tenants.acme.id,
      keyId,
      recordedAt: now.toString(),
      reason: 'erasure',
      ...(commandId === undefined ? {} : { commandId }),
    });
  };
  const keyOf = async (kind: string, id: string): Promise<string | undefined> =>
    uuid.exec(JSON.stringify((await rowOf(kind, id))?.secret ?? ''))?.[1];
  const opens = async (keys: readonly string[]) =>
    new Set(await inUnit((unit) => unit.keys.liveValueKeys([...keys])));
  /** A command of `subject` through the principal id `principalId` (the id of a row of hers): its receipt names the id. */
  const act = async (subject: string, principalId: string): Promise<string> => {
    const commandId = crypto.randomUUID();
    await runtime.invoker.invoke({
      action: 'chain.ping',
      input: { label: 'ping' },
      carrier: testCarrier(runtime.tenants.acme, testPrincipal(subject, { principalId })),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId,
    });
    return commandId;
  };
  const receiptOf = async (commandId: string) =>
    (await inUnit((unit) => unit.receipts.get(commandId))) !== undefined;
  /** What the `erased` events of a row say, by the subject they name. */
  const answersOf = async (
    kind: string,
    id: string,
    names: Readonly<Record<string, 'ada' | 'bea'>>,
  ) =>
    (await inUnit((unit) => unit.events.readStream({ type: `chain.${kind}`, id })))
      .filter((event) => event.type === `chain.${kind}.erased`)
      .map((event) => {
        const data = event.data as { subjectId: string; fields: string[]; owned: boolean };
        return {
          who: names[data.subjectId.toLowerCase()] as 'ada' | 'bea',
          fields: data.fields,
          owned: data.owned,
        };
      })
      .sort((a, b) => a.who.localeCompare(b.who));
  return {
    records,
    live,
    worker,
    runtime,
    operator,
    rowOf,
    make,
    chainOf,
    makeMemo,
    makeDeed,
    makePledge,
    handHolder,
    tombstone,
    change,
    keyOf,
    opens,
    act,
    receiptOf,
    answersOf,
    inUnit,
    tick,
    now: () => now,
  };
}
