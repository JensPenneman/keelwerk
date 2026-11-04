import { expect, test } from 'vitest';
import type { Principal } from '../../principals/principal.ts';
import type { AnyEffect } from '../../protocol/any-effect.ts';
import type { StoredJobSpec } from '../../storage/stored-job-spec.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ScopeTarget } from '../scope-target.ts';
import { performResolverEffects } from './perform-resolver-effects.ts';

test('a timer from a module resolver is keyed to the module service principal', async () => {
  const jobs: StoredJobSpec[] = [];
  const adapter = {
    unit: async (_namespace: unknown, _scope: unknown, run: (unit: unknown) => Promise<void>) =>
      run({ jobs: { enqueue: async (job: StoredJobSpec) => void jobs.push(job) } }),
  };
  const env = {
    options: { clock: { now: () => Temporal.Instant.from('2026-11-04T10:00:00Z') } },
  } as unknown as InvokerEnv;
  const target = {
    scope: { level: 'backend', backendId: 'b' },
    namespace: {},
    handle: { adapter },
  } as unknown as ScopeTarget;
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
  await performResolverEffects(env, target, principal, [timer], 'auth');
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.principal).toEqual({ resolver: 'core.module', principalId: 'auth.system' });
  expect(jobs[0]?.queue).toBe('timers');
});
