import {
  defineApp,
  defineEffect,
  defineEffectExecutor,
  defineModule,
  defineModuleBase,
  field,
  type SubjectId,
  shape,
} from '@keelwerk/core';
import type { PgliteAdapter } from '@keelwerk/data/pglite';
import { afterEach, describe, expect, test } from 'vitest';
import { dumpDatabase, findPlaintext } from '../../src/index.ts';
import { type BootedHooks, bootHooks, probeInput } from './support/hooks-kit.ts';
import { attemptsOf, drainHooks, effectOf, rowsOf } from './support/hooks-reads.ts';
import { watchedHooks } from './support/watched-hooks.ts';

const start = Temporal.Instant.from('2026-03-01T08:00:00Z');
const owner = crypto.randomUUID() as SubjectId;
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

describe('an attempt whose lease is lost (D1, reviewer check 14)', () => {
  test('a lease lost before the start record is retried with the same key', async () => {
    const booted = await watchedHooks(start, cleanup);
    let fences = 0;
    booted.spy.heartbeat = () => (fences++ === 0 ? [] : undefined);
    await booted.client.invoke('hooks.notify', { payload: 'fenced out' });
    await drainHooks(booted);
    // The first attempt never started: no request, no record, the effect is as requested.
    expect(booted.endpoint.requests).toHaveLength(0);
    const requested = await effectOf(booted, 'hooks.post');
    expect(requested?.status).toBe('requested');
    expect(await attemptsOf(booted, String(requested?.id))).toEqual([]);
    await booted.runtime.advanceTo(start.add({ minutes: 2 }));
    await drainHooks(booted);
    const effect = await effectOf(booted, 'hooks.post');
    expect(effect).toMatchObject({ status: 'succeeded', attempts: 1 });
    expect(booted.endpoint.requests).toHaveLength(1);
    expect(booted.endpoint.requests[0]?.headers['idempotency-key']).toBe(String(effect?.id));
    const records = await attemptsOf(booted, String(effect?.id));
    expect(records.map((record) => record.attempt)).toEqual([2, 2]);
  });

  test('a worker whose lease was lost writes no settled record and no attempt end; the next taker settles abandoned with core.effect_outcome_unknown', async () => {
    const booted = await watchedHooks(start, cleanup);
    let completions = 0;
    // The first completion is the end unit of the effect job: the store answers that the lease is gone.
    booted.spy.complete = () => (completions++ === 0 ? false : undefined);
    await booted.client.invoke('hooks.notify', { payload: 'acted, then lost' });
    await drainHooks(booted);
    expect(booted.endpoint.requests).toHaveLength(1);
    const before = await effectOf(booted, 'hooks.post');
    expect(before).toMatchObject({ status: 'requested', attempts: 0 });
    const started = await attemptsOf(booted, String(before?.id));
    expect(started).toHaveLength(1);
    expect(started[0]).not.toHaveProperty('endedAt');
    expect((await rowsOf(booted, 'hooks.delivery'))[0]).toMatchObject({ status: 'pending' });

    await booted.runtime.advanceTo(start.add({ minutes: 2 }));
    await drainHooks(booted);
    const after = await effectOf(booted, 'hooks.post');
    expect(after).toMatchObject({
      status: 'abandoned',
      attempts: 1,
      error: { kind: 'unavailable', code: 'core.effect_outcome_unknown', retryable: false },
    });
    // The destination received the post once and is never asked again.
    expect(booted.endpoint.requests).toHaveLength(1);
    expect((await rowsOf(booted, 'hooks.delivery'))[0]).toMatchObject({ status: 'failed' });
  });
});

describe('an executor option that reads a personal member (lead 6)', () => {
  test('compose refuses a group that reads it', () => {
    const base = defineModuleBase({ id: 'peeker', version: '0.1.0' });
    const notify = defineEffect(base, {
      dataSubject: 'owner',
      input: shape({ owner: field.subject(), to: field.string().personal() }),
    });
    const executor = defineEffectExecutor(base, notify, {
      group: ({ input }) => ({ id: input.to, concurrency: 1 }),
      run: () => Promise.resolve({}),
    });
    const module = defineModule(base, { effects: { notify }, executors: { notify: executor } });
    expect(() => defineApp({ id: 'peekers', modules: [module] })).toThrow(/executorReadsPersonal/);
  });

  test('a group that reads it only on some input passes compose and is refused at enqueue', async () => {
    const booted = await bootHooks({ adapter: 'memory', endpoint: 'http://127.0.0.1:1/hook' });
    cleanup.push(() => booted.runtime.stop());
    await expect(
      booted.client.invoke('probes.run', probeInput(owner, 'peek')),
    ).rejects.toMatchObject({ code: 'core.request_not_allowed' });
    expect(await rowsOf(booted, 'core.effect')).toEqual([]);
  });
});

/** Everything the PGlite database holds, as the owner dumps it: rows, events, stream records, jobs and history. */
async function dumpOf(booted: BootedHooks): Promise<string> {
  return (booted.runtime.adapter as unknown as PgliteAdapter).asOwner((database) =>
    dumpDatabase(async (sql) => (await database.query(sql)).rows as never),
  );
}

describe('a failed settle whose error quotes a personal input value (lead 2, D3)', () => {
  const personal = 'ada.personal-marker@example.org';

  test('leaves no plaintext in rows, events, stream records, jobs or history on pglite', {
    timeout: 120_000,
  }, async () => {
    const booted = await bootHooks({
      adapter: 'pglite',
      endpoint: 'http://127.0.0.1:1/hook',
      clock: { now: () => start },
    });
    cleanup.push(() => booted.runtime.stop());
    // One failure quoted by a keelwerk error, one by a plain throw; both give up at once.
    await booted.client.invoke(
      'probes.run',
      probeInput(owner, 'validation', { note: personal, group: 'v' }),
    );
    await booted.client.invoke(
      'probes.run',
      probeInput(owner, 'quote', { note: personal, group: 'q' }),
    );
    // One whose code has the registered form and repeats the personal note: the code is stored only when the core or the module declared it.
    await booted.client.invoke(
      'probes.run',
      probeInput(owner, 'leak', { note: 'adapersonalmarker', group: 'l' }),
    );
    await drainHooks(booted);
    const effects = (await rowsOf(booted, 'core.effect')).filter(
      (row) => row.type === 'probes.act',
    );
    expect(effects.map((row) => row.status)).toEqual(['failed', 'failed', 'failed']);
    expect(effects.map((row) => (row.error as { code: string }).code).sort()).toEqual([
      'core.internal',
      'core.validation',
      'core.validation',
    ]);
    const dump = await dumpOf(booted);
    // The control: the finder sees a marker that was stored in the clear, and the personal note is sealed.
    expect(dump).toContain('$kwe');
    expect(findPlaintext(dump, ['probes.act'])).toEqual(['probes.act']);
    expect(findPlaintext(dump, [personal, 'adapersonalmarker'])).toEqual([]);
    for (const effect of effects) {
      expect(Object.keys(effect.error as object).sort()).toEqual([
        'code',
        'kind',
        'requestId',
        'retryable',
      ]);
      expect(await attemptsOf(booted, String(effect.id))).toHaveLength(2);
    }
  });
});
