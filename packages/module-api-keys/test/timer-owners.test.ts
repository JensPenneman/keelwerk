import { describe, expect, onTestFinished, test } from 'vitest';
import { createKey, keyOwner } from './support/api-key-calls.ts';
import { type BootedApiKeys, bootApiKeys, type KeysStorage } from './support/boot-api-keys.ts';

const retiredAt = Temporal.Instant.from('2026-12-02T00:00:05Z');

describe.each(['memory', 'pglite'] as const)('api-keys timer owners on %s', (kind: KeysStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedApiKeys> {
    const app = await bootApiKeys(kind);
    onTestFinished(() => app.runtime.stop());
    return app;
  }

  /** Cancels a timer of the scope by its stored key text, as the job store matches it. */
  const cancelStored = (app: BootedApiKeys, key: string) =>
    app.runtime.adapter.unit(app.runtime.namespace, app.scope, (unit) =>
      unit.jobs.cancel('timers', key),
    );

  /**
   * Keeps the workers from taking a job until `release` is called, so a timer the resolver set is
   * still pending when the test cancels it: without the hold the worker may take it first, which
   * depends on how fast the store answers. `timers` holds the key the store was given for each
   * timer job, by the action it runs, as it stores it: the test cancels the timer by what the job
   * store holds, not by a key it builds itself.
   */
  const holdTakes = (app: BootedApiKeys): { release: () => void; timers: Map<string, string> } => {
    let held = true;
    const timers = new Map<string, string>();
    const target = app.runtime.adapter as { unit: typeof app.runtime.adapter.unit };
    const inner = target.unit.bind(app.runtime.adapter);
    target.unit = (namespace, scope, fn, options) =>
      inner(
        namespace,
        scope,
        (unit) =>
          fn({
            ...unit,
            jobs: {
              ...unit.jobs,
              enqueue: (job) => {
                if (job.queue === 'timers' && job.key !== undefined && 'action' in job.run) {
                  timers.set(job.run.action, job.key.value);
                }
                return unit.jobs.enqueue(job);
              },
              take: (queue, worker, request) =>
                held
                  ? Promise.resolve({ jobs: [], skippedLanes: 1 })
                  : unit.jobs.take(queue, worker, request),
            },
          }),
        options,
      );
    return {
      release: () => {
        held = false;
      },
      timers,
    };
  };

  test('the last-use timer is stored under the module of the key, out of reach of another module', {
    timeout,
  }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['read'] });
    expect((await app.withKey(key, 'library.book.query', {})).ok).toBe(true);
    const cancelled = await app
      .as(keyOwner)
      .attempt('later.cancelTimerKey', { key: `api-keys.lastUse:${id}` });
    expect(cancelled.ok).toBe(true);
    expect(await cancelStored(app, `api-keys.lastUse:${id}`)).toBe(0);
    await app.runtime.drainJobs();
    expect((await app.row(id))?.lastUsedAt).toBeDefined();
    // The same timer under its stored key, which only api-keys builds, is the one that ends.
    const again = await createKey(app, { scopes: ['read'] });
    const { release, timers } = holdTakes(app);
    await app.withKey(again.key, 'library.book.query', {});
    const stored = timers.get('api-keys.recordUse');
    expect(stored).toMatch(/^api-keys:[0-9a-f]{64}$/);
    expect(await cancelStored(app, stored ?? '')).toBe(1);
    release();
    await app.runtime.drainJobs();
    expect((await app.row(again.id))?.lastUsedAt).toBeUndefined();
  });

  test('the re-pin timer is stored under the module of the key, out of reach of another module', {
    timeout,
  }, async () => {
    const app = await boot();
    const { key, id } = await createKey(app, { scopes: ['write'], apiVersion: '2026-11-04' });
    await app.runtime.advanceTo(retiredAt);
    expect((await app.withKey(key, 'library.book.query', {})).ok).toBe(true);
    const cancelled = await app
      .as(keyOwner)
      .attempt('later.cancelTimerKey', { key: `api-keys.repin:${id}` });
    expect(cancelled.ok).toBe(true);
    expect(await cancelStored(app, `api-keys.repin:${id}`)).toBe(0);
    await app.runtime.drainJobs();
    expect((await app.row(id))?.apiVersion).toBe('2026-11-11');
    const again = await createKey(app, { scopes: ['write'], apiVersion: '2026-11-04' });
    const { release, timers } = holdTakes(app);
    await app.withKey(again.key, 'library.book.query', {});
    const stored = timers.get('api-keys.repinKey');
    expect(stored).toMatch(/^api-keys:[0-9a-f]{64}$/);
    expect(await cancelStored(app, stored ?? '')).toBe(1);
    release();
    await app.runtime.drainJobs();
    expect((await app.row(again.id))?.apiVersion).toBe('2026-11-04');
  });
});
