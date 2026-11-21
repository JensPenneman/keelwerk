import type { SubjectId } from '@keelwerk/core';
import { expect } from 'vitest';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import { bootHooks } from './hooks-kit.ts';
import { limitTenant, putOverTheLimits, readStore, watchQuotaLoads } from './over-the-limit.ts';
import { pingRuns } from './probes-module.ts';
import type { StoredBytesOptions } from './stored-bytes-cases.ts';

// A command with `prepare` of a tenant over its storage limits, as production puts it there: real
// commands store records and `core.quota.set` lowers the limits (`over-the-limit.ts`). The command
// is `probes.look`, whose `prepare` performs the inline effect `ping`; `pingRuns` counts the runs
// of its executor. What decides each case: the committed store, the executor's count and the
// counters after the awaited calls; no worker is started, so nothing in the background moves them,
// and the quota cache is read only through its own awaited loads.

/** A runtime of the hooks app without workers and with the operator socket, and what a case does with it. */
async function boot(options: StoredBytesOptions) {
  const loads = watchQuotaLoads();
  const booted = await bootHooks({
    ...options,
    endpoint: 'http://127.0.0.1:1/hook',
    serveOnly: true,
    operators: true,
    logger: loads.logger,
  });
  // The count is the process's: a case reads what its own commands added.
  const baseline = pingRuns.count;
  const runs = () => pingRuns.count - baseline;
  const owner = crypto.randomUUID() as SubjectId;
  const client = createLocalClient(booted.runtime, { principal: testPrincipal(owner) });
  const grow = () => client.attempt('hooks.notify', { payload: 'grow' });
  const look = (commandId: string = crypto.randomUUID()) =>
    client.attempt('probes.look', { owner }, { commandId });
  const over = { runtime: booted.runtime, scope: booted.scope, loads, grow };
  /** The rows of `probes.target` in the tables: what the decision of `probes.look` stores. */
  const targetRows = async () => {
    const entity = booted.runtime.app.registry.entities.get('probes.target');
    if (entity === undefined) throw new Error('the app has no probes.target');
    return booted.raw(async (unit) => (await unit.rows.find(entity.descriptor, {})).rows.length);
  };
  /** What the tenant holds that a refused command must not add to. */
  const holdings = async () => {
    const read = await readStore(over);
    return {
      counted: read.counted,
      rows: read.rows,
      events: read.events.length,
      attempts: (read.streams.get('core.effectAttempt') ?? []).length,
      effectEvents: read.events.filter((event) => event.stream.type === 'core.effect').length,
      targets: await targetRows(),
    };
  };
  const receipt = (commandId: string) => booted.raw((unit) => unit.receipts.get(commandId));
  return { booted, over, look, grow, holdings, receipt, runs };
}

/**
 * The tenant stands above both limits: a command with `prepare` is refused before it runs, its
 * executor is never called and it leaves no effect record, no attempt, no receipt and no charge,
 * while a command without `prepare` is refused at its tail; the resend of a finished command is
 * answered from its receipt, runs nothing and charges nothing.
 */
export async function admissionOverTheLimits(options: StoredBytesOptions): Promise<void> {
  const { booted, over, look, holdings, receipt, runs } = await boot(options);
  try {
    const finished = await look();
    expect(finished.ok).toBe(true);
    expect(runs()).toBe(1);
    await putOverTheLimits(over);
    const before = await holdings();
    const ran = runs();

    const fresh = crypto.randomUUID();
    const refused = await look(fresh);
    expect(refused.ok ? undefined : refused.error.code).toBe('core.quota_exceeded');
    expect(runs()).toBe(ran);
    expect(await holdings()).toEqual(before);
    expect(await receipt(fresh)).toBeUndefined();

    if (!finished.ok || finished.commandId === undefined) throw new Error('the first look failed');
    const resent = await look(finished.commandId);
    expect(resent).toEqual(finished);
    expect(runs()).toBe(ran);
    expect(await holdings()).toEqual(before);
  } finally {
    await booted.runtime.stop();
  }
}

/**
 * The command that crosses its limit by its own writes: with the limit at the counter's value it is
 * admitted, performs its inline effect once and its decision is stored whatever the counters are by
 * then (the commit tail of a command with `prepare` never refuses it by a storage limit): a
 * completed receipt, the target row of the decision, counters equal to what the store holds and
 * above the limit. The next command is refused before `prepare`. What decides it: the awaited calls,
 * the executor's count, the receipt, the rows and the counters read after them; nothing runs in the
 * background.
 */
export async function admissionAtTheLimit(options: StoredBytesOptions): Promise<void> {
  const { booted, over, look, grow, holdings, receipt, runs } = await boot(options);
  try {
    expect((await grow()).ok).toBe(true);
    const start = await holdings();
    await limitTenant(over, 'core.eventBytes', String(start.counted));
    const ran = runs();

    const id = crypto.randomUUID();
    const crossing = await look(id);
    expect(crossing.ok).toBe(true);
    expect(runs()).toBe(ran + 1);
    expect(await receipt(id)).toMatchObject({ status: 'completed' });
    const crossed = await holdings();
    expect(crossed.effectEvents).toBeGreaterThan(start.effectEvents);
    expect(crossed.attempts).toBeGreaterThan(start.attempts);
    expect(crossed.targets).toBe(start.targets + 1);
    // Above the limit, by the effect record and by the decision, and equal to what the store holds.
    expect(crossed.counted).toBeGreaterThan(start.counted);
    expect(crossed.rows).toBe(start.rows + 1n);
    const read = await readStore(over);
    expect(read.counted).toBe(read.stored);

    const next = await look();
    expect(next.ok ? undefined : next.error.code).toBe('core.quota_exceeded');
    expect(runs()).toBe(ran + 1);
    expect(await holdings()).toEqual(crossed);
  } finally {
    await booted.runtime.stop();
  }
}
