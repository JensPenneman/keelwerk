import { expect, test } from 'vitest';
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
    options: { clock: { now: () => Temporal.Instant.from('2026-11-04T10:00:00Z') } },
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

test('a timer without a module is refused and writes nothing', async () => {
  const { jobs, env, target, principal, timer } = setup();
  await expect(performResolverEffects(env, target, principal, [timer])).rejects.toMatchObject({
    code: 'core.request_not_allowed',
  });
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
