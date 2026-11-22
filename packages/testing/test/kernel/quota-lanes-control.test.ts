import {
  defineApp,
  defineCommand,
  defineHook,
  defineModule,
  defineModuleBase,
  defineRule,
  enqueue,
  errors,
  shape,
} from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { describe, expect, test } from 'vitest';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { jobSpy } from './support/job-spy.ts';
import { bootWorking, deploymentOf } from './support/runtime-kit.ts';

// The jobs that the control path and the runtime's control commands enqueue take their lane's cap
// and weight from the limits of the backend they are for, which a process hands them by its one
// quota cache. The hook of a new tenant fails at its first attempt with an error that is not retried, so
// no retry falls due on the real clock the workers run on: the job ends, `hookFailed` is written and only the
// rerun decides the hook again (a conflict is not a retried kind, so no job of this file draws a retry
// delay and nothing here is decided by the draws). What decides each case: the job the store was handed, found by its queue and scope
// level; with the wiring of a path taken out the job has the default lane (cap 4).

const base = defineModuleBase({ id: 'wiring', version: '0.1.0' });
const ping = defineCommand(base, {
  input: shape({}),
  output: shape({}),
  principal: 'user',
  execution: 'async',
  decide: () => ({ events: [], result: {} }),
});

const pingBackend = defineCommand(base, {
  scope: 'backend',
  input: shape({}),
  output: shape({}),
  principal: 'user',
  execution: 'async',
  decide: () => ({ events: [], result: {} }),
});

/** The hook of a new tenant fails at its first attempt for good and enqueues a command when a rerun decides it again; the hook of a new backend enqueues one. */
function appOf() {
  const state = { tenantHookRuns: 0 };
  const module = defineModule(base, {
    actions: { ping, pingBackend },
    policies: {
      ping: { open: defineRule(base, ping, { effect: 'allow', principal: 'user' }) },
      pingBackend: { open: defineRule(base, pingBackend, { effect: 'allow', principal: 'user' }) },
    },
    lifecycle: {
      onBackendCreated: defineHook(base, 'onBackendCreated', () => ({
        events: [],
        effects: [enqueue(pingBackend, {})],
      })),
      onTenantCreated: defineHook(base, 'onTenantCreated', () => {
        state.tenantHookRuns += 1;
        if (state.tenantHookRuns === 1) throw errors.conflict('not yet');
        return { events: [], effects: [enqueue(ping, {})] };
      }),
    },
  });
  return { state, app: withTestResolver(defineApp({ id: 'wiring-app', modules: [module] })) };
}

const quotas = {
  'queue:hooks.running': '7',
  'queue:hooks.weight': '3',
  'queue:commands.running': '6',
  'queue:commands.weight': '2',
};

describe('the jobs of a backend and a tenant that are created while the process runs', () => {
  test('the hook of a new backend, the hook job of a new tenant and a rerun of its hook take their lane from the backend limits', async () => {
    const { app } = appOf();
    const watched = jobSpy(() => undefined, memoryAdapter());
    const { runtime, drain } = await bootWorking(
      deploymentOf('memory', { apps: [app], factory: watched.factory }),
    );
    const backend = await runtime.control.createBackend({
      name: 'b',
      app: 'wiring-app',
      placement: 'main',
      config: { core: { quotas } },
    });
    const jobsOf = (queue: string, level: string) =>
      watched.spy.enqueued
        .map((entry) => entry.job)
        .filter((job) => job.queue === queue && job.scope.level === level);
    // The hook of the backend decides in the backend's scope and enqueues a command there.
    expect(jobsOf('commands', 'backend')).toHaveLength(1);
    expect(jobsOf('commands', 'backend')[0]).toMatchObject({ laneCap: 6, laneWeight: 2 });
    const tenant = await runtime.control.createTenant({ backendId: backend.id, name: 't' });
    expect(jobsOf('hooks', 'tenant')).toHaveLength(1);
    expect(jobsOf('hooks', 'tenant')[0]).toMatchObject({ laneCap: 7, laneWeight: 3 });
    // The hook job fails at its first attempt, ends there and writes `hookFailed`; the rerun decides it again.
    await drain();
    expect(jobsOf('commands', 'tenant')).toHaveLength(0);
    await runtime.control.rerunTenantHooks(tenant.id);
    expect(jobsOf('commands', 'tenant')).toHaveLength(1);
    expect(jobsOf('commands', 'tenant')[0]).toMatchObject({ laneCap: 6, laneWeight: 2 });
  });
});
