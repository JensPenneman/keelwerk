import { afterAll, describe, expect, test } from 'vitest';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker, seededAt } from './support/ticker-kit.ts';

const adapters = ['memory', 'pglite'] as const;

describe.each(adapters)('a command that names another scope, on %s', (adapter) => {
  const kits: TickerKit[] = [];
  const boot = async () => {
    const kit = await bootTicker({ adapter });
    kits.push(kit);
    return kit;
  };
  afterAll(async () => {
    for (const kit of kits) await kit.stop();
  });
  const beats = async (kit: TickerKit, source: string) =>
    (await kit.rows('backend', 'ticker.beat')).filter((row) => row.source === source);
  const failureCode = (outcome: {
    readonly ok: boolean;
    readonly error?: { readonly code: string };
  }) => (outcome.ok ? undefined : outcome.error?.code);

  test('an enqueue of a backend command from a tenant command commits and runs', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    expect((await kit.call('acme', 'ticker.escalate', { at: 'now' })).ok).toBe(true);
    // The job is the tenant unit's: it sits in the tenant's lane and keys.
    const job = kit.spy.enqueued
      .map((entry) => entry.job)
      .find((spec) => spec.queue === 'commands');
    expect(job?.scope).toEqual(kit.scopeOf('acme'));
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    expect((await beats(kit, 'enqueue')).map((row) => row.at)).toEqual(['now']);
    expect(await kit.rows('acme', 'ticker.tick')).toHaveLength(0);
    expect(await kit.rows('globex', 'ticker.tick')).toHaveLength(0);
  });

  test('a command id chosen in a tenant for a backend command is refused in every tenant', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    for (const tenant of ['acme', 'globex'] as const) {
      const outcome = await kit.call(tenant, 'ticker.escalateChosen', { at: tenant });
      expect(failureCode(outcome)).toBe('core.request_not_allowed');
    }
    expect(kit.spy.enqueued.filter((entry) => entry.job.queue === 'commands')).toHaveLength(0);
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    expect(await beats(kit, 'enqueue')).toHaveLength(0);
  });

  test("the job commits with the tenant's decision: a failing decision leaves no job", {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    const outcome = await kit.call('acme', 'ticker.escalateFailing', { at: 'now' });
    expect(outcome.ok).toBe(false);
    expect(kit.spy.enqueued.filter((entry) => entry.job.queue === 'commands')).toHaveLength(0);
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    expect(await beats(kit, 'enqueue')).toHaveLength(0);
  });

  test('an invoke of a backend command from a tenant runs after commit', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    expect((await kit.call('acme', 'ticker.invokeUp', { at: 'now' })).ok).toBe(true);
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    expect((await beats(kit, 'invoke')).map((row) => row.at)).toEqual(['now']);
  });

  test('an invoke as system across scopes is refused', { timeout: 30_000 }, async () => {
    const kit = await boot();
    const outcome = await kit.call('acme', 'ticker.invokeUpAsSystem', { at: 'now' });
    expect(failureCode(outcome)).toBe('core.request_not_allowed');
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    expect(await beats(kit, 'invoke')).toHaveLength(0);
  });

  test('a backend command cannot enqueue a tenant command', { timeout: 30_000 }, async () => {
    const kit = await boot();
    const outcome = await kit.call('acme', 'ticker.reachDown', { at: 'now' });
    expect(failureCode(outcome)).toBe('core.request_not_allowed');
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    expect(
      (await kit.rows('acme', 'ticker.tick')).filter((row) => row.schedule === 'down'),
    ).toHaveLength(0);
  });

  test('a crash between the backend command and the completion of its job runs the command once', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    let lost = 1;
    // The first completion is refused as if the lease were lost: the command's own unit already committed.
    kit.spy.complete = () => {
      if (lost === 0) return undefined;
      lost -= 1;
      return false;
    };
    expect((await kit.call('acme', 'ticker.escalate', { at: 'once' })).ok).toBe(true);
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    await kit.advanceTo(seededAt.add({ minutes: 5 }));
    expect((await beats(kit, 'enqueue')).map((row) => row.at)).toEqual(['once']);
    // The job ran twice, the command's receipt in the backend scope replayed the second run.
    const taken = kit.spy.takes
      .filter((take) => take.queue === 'commands')
      .flatMap((take) => take.jobs);
    expect(taken).toHaveLength(2);
  });

  test('a short idempotency window does not shorten the guard of a job that crosses scopes', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    let lost = 1;
    // The backend command commits, then the settle in the tenant's unit is lost: the job runs again after the 30 s window.
    kit.spy.complete = () => {
      if (lost === 0) return undefined;
      lost -= 1;
      return false;
    };
    expect((await kit.call('acme', 'ticker.escalateShortLived', { at: 'once' })).ok).toBe(true);
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    await kit.advanceTo(seededAt.add({ minutes: 5 }));
    expect((await beats(kit, 'short')).map((row) => row.at)).toEqual(['once']);
    const taken = kit.spy.takes
      .filter((take) => take.queue === 'commands')
      .flatMap((take) => take.jobs);
    expect(taken).toHaveLength(2);
  });

  test('every job that crosses scopes belongs to the group of its backend', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    await kit.call('acme', 'ticker.escalate', { at: 'a' });
    await kit.call('acme', 'ticker.invokeUp', { at: 'b' });
    await kit.call('globex', 'ticker.escalate', { at: 'c' });
    const crossing = kit.spy.enqueued
      .map((entry) => entry.job)
      .filter((spec) => spec.queue === 'commands');
    expect(crossing).toHaveLength(3);
    for (const spec of crossing) {
      expect(spec.group).toEqual({
        id: `core.cross-scope:${kit.runtime.backendId}`,
        concurrency: 4,
        scope: 'namespace',
      });
    }
    await kit.advanceTo(seededAt.add({ seconds: 1 }));
    expect((await beats(kit, 'enqueue')).map((row) => row.at).toSorted()).toEqual(['a', 'c']);
    expect((await beats(kit, 'invoke')).map((row) => row.at)).toEqual(['b']);
  });

  test('delayed work across scopes is an enqueue with runAt and a key, run as the source principal', {
    timeout: 30_000,
  }, async () => {
    const kit = await boot();
    const runAt = seededAt.add({ minutes: 2 });
    expect(
      (await kit.call('acme', 'ticker.escalateLater', { at: 'later', runAt: runAt.toString() })).ok,
    ).toBe(true);
    await kit.advanceTo(runAt.subtract({ seconds: 1 }));
    expect(await beats(kit, 'later')).toHaveLength(0);
    await kit.advanceTo(runAt);
    expect((await beats(kit, 'later')).map((row) => row.at)).toEqual(['later']);
  });
});
