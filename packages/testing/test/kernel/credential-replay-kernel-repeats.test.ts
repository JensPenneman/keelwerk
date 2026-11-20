import { afterAll, describe, expect, test } from 'vitest';
import { vaultJobId } from './support/ticker-commands.ts';
import { bootTicker, seededAt } from './support/ticker-kit.ts';

describe('the kernel repeats its own finished commands (WP-181)', () => {
  const kits: Awaited<ReturnType<typeof bootTicker>>[] = [];
  afterAll(async () => {
    for (const kit of kits) await kit.stop();
  });

  test('a job that crosses scopes for an anonymous caller completes when its settle was lost', {
    timeout: 30_000,
  }, async () => {
    const kit = await bootTicker({ adapter: 'memory' });
    kits.push(kit);
    let lost = 1;
    // The backend command commits in its own unit, then the settle in the tenant's unit is lost.
    kit.spy.complete = () => {
      if (lost === 0) return undefined;
      lost -= 1;
      return false;
    };
    const anonymousCarrier = {
      transport: 'test',
      headers: { 'x-tenant': kit.runtime.tenants.acme.id },
    };
    const sent = await kit.runtime.invoker.invoke({
      action: 'ticker.unlockUp',
      input: { at: 'once', pin: '4711' },
      carrier: anonymousCarrier,
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    expect(sent.ok).toBe(true);
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    const first = kit.spy.takes
      .filter((take) => take.queue === 'commands')
      .flatMap((take) => take.jobs);
    expect(first).toHaveLength(1);
    const run = first.at(0)?.run as { commandId?: string } | undefined;
    const commandId = run?.commandId ?? '';
    expect(commandId.startsWith('kernel:effect:')).toBe(true);
    const receiptOfBackend = () =>
      kit.runtime.sealed.unit(
        kit.runtime.namespace,
        kit.scopeOf('backend'),
        (unit) => unit.receipts.get(commandId),
        { readOnly: true },
      );
    const before = await receiptOfBackend();
    expect(before?.status).toBe('completed');
    expect(before?.principal).toBeNull();
    await kit.advanceTo(seededAt.add({ minutes: 5 }));
    const taken = kit.spy.takes
      .filter((take) => take.queue === 'commands')
      .flatMap((take) => take.jobs);
    expect(taken).toHaveLength(2);
    // The second attempt ends the job succeeded and leaves the receipt as the first attempt wrote it.
    const settled = kit.spy.completions.filter((entry) => entry.granted);
    expect(settled.at(-1)?.outcome.kind).toBe('succeeded');
    expect(await receiptOfBackend()).toEqual(before);
    const beats = (await kit.rows('backend', 'ticker.beat')).filter(
      (row) => row.source === 'vault',
    );
    expect(beats.map((row) => row.at)).toEqual(['once']);
  });

  test('a job repeating the receipt another job of an anonymous caller wrote under a chosen command id ends succeeded', {
    timeout: 30_000,
  }, async () => {
    const kit = await bootTicker({ adapter: 'memory' });
    kits.push(kit);
    const sent = await kit.runtime.invoker.invoke({
      action: 'ticker.unlockTwice',
      input: { at: 'twice', pin: '4711' },
      carrier: { transport: 'test', headers: { 'x-tenant': kit.runtime.tenants.acme.id } },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    expect(sent.ok).toBe(true);
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    const receiptOfTenant = () =>
      kit.runtime.sealed.unit(
        kit.runtime.namespace,
        kit.scopeOf('acme'),
        (unit) => unit.receipts.get(vaultJobId),
        { readOnly: true },
      );
    const before = await receiptOfTenant();
    expect(before?.status).toBe('completed');
    expect(before?.principal).toBeNull();
    await kit.advanceTo(seededAt.add({ minutes: 5 }));
    const jobs = kit.spy.takes
      .filter((take) => take.queue === 'commands')
      .flatMap((take) => take.jobs)
      .filter((job) => (job.run as { commandId?: string }).commandId === vaultJobId);
    expect(new Set(jobs.map((job) => job.id)).size).toBe(2);
    const ids = new Set(jobs.map((job) => job.id));
    // Both jobs end succeeded: the second job meets a receipt the first job's run wrote (transport job), replayed.
    const ended = kit.spy.completions.filter(
      (entry) => entry.granted && ids.has(entry.attempt.jobId),
    );
    expect(ended.map((entry) => entry.outcome.kind)).toEqual(['succeeded', 'succeeded']);
    expect(await receiptOfTenant()).toEqual(before);
    const ticks = (await kit.rows('acme', 'ticker.tick')).filter((row) => row.schedule === 'vault');
    expect(ticks.map((row) => row.at)).toEqual(['twice']);
  });

  test('a job meeting a receipt a caller wrote directly under its chosen command id ends failed', {
    timeout: 30_000,
  }, async () => {
    const kit = await bootTicker({ adapter: 'memory' });
    kits.push(kit);
    const carrier = { transport: 'test', headers: { 'x-tenant': kit.runtime.tenants.acme.id } };
    const invoke = (action: string, input: unknown, commandId?: string) =>
      kit.runtime.invoker.invoke({
        action,
        input,
        carrier,
        ...(commandId === undefined ? {} : { commandId }),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
    // An anonymous caller runs the command directly under the id the application's jobs will choose.
    const direct = await invoke('ticker.recordVaultTick', { at: 'twice', pin: '0000' }, vaultJobId);
    expect(direct.ok).toBe(true);
    const receiptOfTenant = () =>
      kit.runtime.sealed.unit(
        kit.runtime.namespace,
        kit.scopeOf('acme'),
        (unit) => unit.receipts.get(vaultJobId),
        { readOnly: true },
      );
    const before = await receiptOfTenant();
    expect(before?.status).toBe('completed');
    expect(before?.principal).toBeNull();
    const sent = await invoke('ticker.unlockTwice', { at: 'twice', pin: '4711' });
    expect(sent.ok).toBe(true);
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    const jobs = kit.spy.takes
      .filter((take) => take.queue === 'commands')
      .flatMap((take) => take.jobs)
      .filter((job) => (job.run as { commandId?: string }).commandId === vaultJobId);
    const ids = new Set(jobs.map((job) => job.id));
    expect(ids.size).toBe(2);
    const ended = kit.spy.completions.filter(
      (entry) => entry.granted && ids.has(entry.attempt.jobId),
    );
    expect(ended.map((entry) => entry.outcome.kind)).toEqual(['failed', 'failed']);
    for (const entry of ended) {
      expect(entry.outcome).toMatchObject({ error: { code: 'core.idempotency_mismatch' } });
    }
    expect(await receiptOfTenant()).toEqual(before);
    const ticks = (await kit.rows('acme', 'ticker.tick')).filter((row) => row.schedule === 'vault');
    expect(ticks.map((row) => row.at)).toEqual(['twice']);
  });
});
