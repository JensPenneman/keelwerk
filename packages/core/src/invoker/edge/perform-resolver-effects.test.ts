import { expect, test } from 'vitest';
import { jobKeyDigest } from '../../effects/job-key-digest.ts';
import { isKernelCommandId } from '../../ids/is-kernel-command-id.ts';
import type { Principal } from '../../principals/principal.ts';
import type { AnyEffect } from '../../protocol/any-effect.ts';
import type { StoredJobSpec } from '../../storage/stored-job-spec.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ScopeTarget } from '../scope-target.ts';
import { performResolverEffects } from './perform-resolver-effects.ts';

function setup(actionScope = 'backend', sessionScope: 'backend' | 'tenant' = 'backend') {
  const jobs: StoredJobSpec[] = [];
  const unit = { jobs: { enqueue: async (job: StoredJobSpec) => void jobs.push(job) } };
  const adapter = {
    unit: async (_namespace: unknown, _scope: unknown, run: (unit: unknown) => Promise<void>) =>
      run(unit),
  };
  const touch = {
    kind: 'command',
    ref: 'auth.touch',
    module: 'auth',
    scope: actionScope,
    input: {},
  };
  const env = {
    options: {
      clock: { now: () => Temporal.Instant.from('2026-11-04T10:00:00Z') },
      keys: { derive: async () => new Uint8Array(32).fill(7) },
    },
    appOf: () => ({ registry: { actions: new Map([['auth.touch', touch]]) } }),
  } as unknown as InvokerEnv;
  const target = {
    scope:
      sessionScope === 'tenant'
        ? { level: 'tenant', backendId: 'b', tenantId: 't' }
        : { level: 'backend', backendId: 'b' },
    namespace: { appId: 'portal' },
    handle: { adapter },
  } as unknown as ScopeTarget;
  const enqueue = {
    kind: 'enqueue',
    type: 'enqueue',
    action: 'auth.touch',
    input: {},
  } as unknown as AnyEffect;
  const principal = {
    kind: 'user',
    subject: 'ada',
    via: 'auth.session',
    scope: { backend: 'b', tenant: null },
  } as unknown as Principal;
  const timer = {
    kind: 'setTimer',
    type: 'setTimer',
    key: 'idle:1',
    after: '45s',
    action: 'auth.touch',
    input: {},
  } as unknown as AnyEffect;
  return { jobs, env, target, principal, timer, enqueue };
}

test('a timer from a module resolver is keyed to the module service principal and has a kernel command id', async () => {
  const { jobs, env, target, principal, timer } = setup();
  await performResolverEffects(env, target, principal, [timer], 'auth');
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.principal).toEqual({ resolver: 'core.module', principalId: 'auth.system' });
  expect(jobs[0]?.queue).toBe('timers');
  const run = jobs[0]?.run;
  expect(run !== undefined && 'commandId' in run && isKernelCommandId(run.commandId ?? '')).toBe(
    true,
  );
  expect(
    run !== undefined && 'commandId' in run && run.commandId?.startsWith('kernel:timer:'),
  ).toBe(true);
});

test('a timer from a module resolver is stored under the module id and the digest of its key', async () => {
  const { jobs, env, target, principal, timer } = setup();
  await performResolverEffects(env, target, principal, [timer], 'auth');
  // WP-130: HMAC-SHA-256 of the module `auth` and `idle:1` under a job key secret of 32 bytes of 7
  // (the digest binds its owner); the key text is not stored.
  expect(jobs[0]?.key).toEqual({
    value: 'auth:dc6f6fa158cabee451093366dc1274c6cf7348b86ea6c0b25c64eb330c368618',
    onConflict: 'replace',
  });
});

test('a timer without a module is refused, does not name its key and writes nothing', async () => {
  const { jobs, env, target, principal, timer } = setup();
  const error = await performResolverEffects(env, target, principal, [timer]).catch(
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({ code: 'core.request_not_allowed' });
  expect(JSON.stringify(error)).not.toContain('idle:1');
  expect(jobs).toHaveLength(0);
});

test('a timer naming no command of the app is refused', async () => {
  const { jobs, env, target, principal, timer } = setup();
  const other = { ...timer, action: 'auth.absent' } as unknown as AnyEffect;
  await expect(
    performResolverEffects(env, target, principal, [other], 'auth'),
  ).rejects.toMatchObject({ code: 'core.request_not_allowed' });
  expect(jobs).toHaveLength(0);
});

test('a timer naming a command of a level the session cannot reach is refused', async () => {
  const { jobs, env, target, principal, timer } = setup('tenant');
  await expect(
    performResolverEffects(env, target, principal, [timer], 'auth'),
  ).rejects.toMatchObject({ code: 'core.request_not_allowed' });
  expect(jobs).toHaveLength(0);
});

test('a timer naming a backend command from a tenant session is refused: a timer does not cross scopes', async () => {
  const { jobs, env, target, principal, timer } = setup('backend', 'tenant');
  await expect(
    performResolverEffects(env, target, principal, [timer], 'auth'),
  ).rejects.toMatchObject({
    code: 'core.request_not_allowed',
    details: { reason: expect.stringContaining('a timer does not cross scopes') },
  });
  expect(jobs).toHaveLength(0);
});

test('an enqueue naming a backend command from a tenant session carries a kernel command id and the backend group', async () => {
  const { jobs, env, target, principal, enqueue } = setup('backend', 'tenant');
  await performResolverEffects(env, target, principal, [enqueue], 'auth');
  expect(jobs).toHaveLength(1);
  const run = jobs[0]?.run;
  expect(run !== undefined && 'commandId' in run && isKernelCommandId(run.commandId ?? '')).toBe(
    true,
  );
  expect(
    run !== undefined && 'commandId' in run && run.commandId?.startsWith('kernel:effect:'),
  ).toBe(true);
  expect(jobs[0]?.principal).toEqual({ resolver: 'auth.session', principalId: 'ada' });
  expect(jobs[0]?.group).toEqual({
    id: 'core.cross-scope:b',
    concurrency: 4,
    scope: 'namespace',
  });
});

test('an enqueue of a tenant command from a backend session is refused and writes nothing', async () => {
  const { jobs, env, target, principal, enqueue } = setup('tenant');
  await expect(performResolverEffects(env, target, principal, [enqueue])).rejects.toMatchObject({
    code: 'core.request_not_allowed',
  });
  expect(jobs).toHaveLength(0);
});

test('an enqueue in its own scope carries a kernel command id and no group', async () => {
  const { jobs, env, target, principal, enqueue } = setup();
  await performResolverEffects(env, target, principal, [enqueue]);
  expect(jobs[0]?.group).toBeUndefined();
  const run = jobs[0]?.run;
  expect(
    run !== undefined && 'commandId' in run && run.commandId?.startsWith('kernel:effect:'),
  ).toBe(true);
});

test('a resolver effect never names core.eraseSubject, enqueue or timer, and writes nothing', async () => {
  const { jobs, env, target, principal } = setup();
  const erase = (kind: 'enqueue' | 'setTimer'): AnyEffect =>
    ({
      kind,
      type: kind,
      action: 'core.eraseSubject',
      key: 'idle:1',
      after: '45s',
      input: {},
    }) as unknown as AnyEffect;
  const withErase = {
    ...env,
    appOf: () => ({
      registry: {
        actions: new Map([
          ['core.eraseSubject', { kind: 'command', ref: 'core.eraseSubject', module: 'core' }],
        ]),
      },
    }),
  } as unknown as InvokerEnv;
  for (const kind of ['enqueue', 'setTimer'] as const) {
    await expect(
      performResolverEffects(withErase, target, principal, [erase(kind)], 'auth'),
    ).rejects.toMatchObject({ code: 'core.request_not_allowed' });
  }
  expect(jobs).toHaveLength(0);
});

const keyed = (effect: AnyEffect): AnyEffect =>
  ({ ...effect, key: 'idle:1' }) as unknown as AnyEffect;

test('a keyed enqueue from a module resolver is stored under the key of that module', async () => {
  const { jobs, env, target, principal, enqueue } = setup();
  await performResolverEffects(env, target, principal, [keyed(enqueue)], 'auth');
  expect(jobs[0]?.key).toEqual({
    value: `auth:${jobKeyDigest(new Uint8Array(32).fill(7), 'auth', 'idle:1')}`,
    onConflict: 'keep',
  });
});

test('a keyed enqueue without the module of its resolver is refused, does not name its key and writes nothing', async () => {
  const { jobs, env, target, principal, enqueue } = setup();
  const error = await performResolverEffects(env, target, principal, [keyed(enqueue)]).catch(
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({ code: 'core.request_not_allowed' });
  expect(JSON.stringify(error)).not.toContain('idle:1');
  expect(jobs).toEqual([]);
});

const quotas = {
  limitOf: () => ({ kind: 'count', value: 0 }),
  queueOf: () => ({ running: 4, queued: 7, weight: 1 }),
  fresh: async () => undefined,
} as unknown as NonNullable<InvokerEnv['options']['quotas']>;

test('an enqueue of a session carries the queued cap of its scope, without quotas none', async () => {
  const { jobs, env, target, principal, enqueue } = setup('backend', 'tenant');
  await performResolverEffects(env, target, principal, [enqueue], 'auth');
  expect(jobs[0]?.queuedCap).toBeUndefined();
  const limited = { ...env, options: { ...env.options, quotas } } as InvokerEnv;
  await performResolverEffects(limited, target, principal, [enqueue], 'auth');
  expect(jobs[1]?.queuedCap).toBe(7);
});

test('a timer of a resolver carries no queued cap', async () => {
  const { jobs, env, target, principal, timer } = setup();
  const limited = { ...env, options: { ...env.options, quotas } } as InvokerEnv;
  await performResolverEffects(limited, target, principal, [timer], 'auth');
  expect(jobs[0]?.queuedCap).toBeUndefined();
});

test('the cap of an enqueue is the one read after the quota cache has been refreshed', async () => {
  const { jobs, env, target, principal, enqueue } = setup('backend', 'tenant');
  let loaded = false;
  const cold = {
    ...quotas,
    // Until the first load the declared default serves, as in a process that has run no command yet.
    queueOf: () => ({ running: 4, queued: loaded ? 7 : 10_000, weight: 1 }),
    fresh: async () => {
      loaded = true;
    },
  } as unknown as NonNullable<InvokerEnv['options']['quotas']>;
  const limited = { ...env, options: { ...env.options, quotas: cold } } as InvokerEnv;
  await performResolverEffects(limited, target, principal, [enqueue], 'auth');
  expect(jobs[0]?.queuedCap).toBe(7);
});
