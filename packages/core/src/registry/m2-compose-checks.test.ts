import { describe, expect, test } from 'vitest';
import { m2Parts } from '../../test/fixtures/modules/m2-parts/src/module.generated.ts';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineCommand } from '../dsl/define-command.ts';
import { defineEffect } from '../dsl/define-effect.ts';
import { defineEffectExecutor } from '../dsl/define-effect-executor.ts';
import { defineFlag } from '../dsl/define-flag.ts';
import { defineReaction } from '../dsl/define-reaction.ts';
import { defineSchedule } from '../dsl/define-schedule.ts';
import { defineStream } from '../dsl/define-stream.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from './build-registry.ts';
import { checkDeploymentGroups } from './check-deployment-groups.ts';
import { checkJsonFlagDefaults } from './check-json-flag-defaults.ts';
import { checkObservesAll } from './check-observes-all.ts';
import { checkProcessEvents } from './check-process-events.ts';
import { checkQuotaDefaults } from './check-quota-defaults.ts';
import { checkStreamDeclarations } from './check-stream-declarations.ts';
import { checkStreamOffload } from './check-stream-offload.ts';
import { m2ComposeChecks } from './m2-compose-checks.ts';

function executorApp(group: () => object) {
  const base = { id: 'jobs', version: '0.1.0' } as never;
  const ping = defineEffect(base, { input: shape({ url: field.string() }), output: shape({}) });
  const executor = defineEffectExecutor(base, ping, {
    group,
    run: async () => ({}),
  } as never);
  return appOf([makeModule(base, { effects: { ping }, executors: { ping: executor } })]);
}

describe('the M2 compose checks', () => {
  test('refuses a stream that declares offload', () => {
    const log = defineStream({
      key: field.string(),
      record: shape({ line: field.string() }),
      readAs: 'row',
      offload: { afterPerKey: 100 },
    });
    const app = appOf([makeModule({ id: 'logs', streams: { log } })]);
    expect(checkStreamOffload(app, buildRegistry(app))).toEqual([
      expect.objectContaining({
        code: 'streamOffloadUnavailable',
        severity: 'error',
        module: 'logs',
        ref: 'logs.log',
      }),
    ]);
  });

  test('refuses an executor whose group has deployment scope', () => {
    const app = executorApp(() => ({ id: 'all', scope: 'deployment' }));
    expect(checkDeploymentGroups(app, buildRegistry(app))).toEqual([
      expect.objectContaining({ code: 'deploymentGroupsUnavailable', ref: 'jobs.ping' }),
    ]);
  });

  test('accepts an executor whose group has namespace scope', () => {
    const app = executorApp(() => ({ id: 'all', scope: 'namespace' }));
    expect(checkDeploymentGroups(app, buildRegistry(app))).toEqual([]);
  });

  test('skips a group probe that throws', () => {
    const app = executorApp(() => {
      throw new TypeError('needs a real input');
    });
    expect(checkDeploymentGroups(app, buildRegistry(app))).toEqual([]);
  });

  test("refuses on: 'all' in a module that does not observe all", () => {
    const base = { id: 'quiet', version: '0.1.0' } as never;
    const audit = defineReaction(base, { on: 'all', react: () => ({ events: [] }) } as never);
    const app = appOf([makeModule(base, { reactions: { audit } })]);
    expect(checkObservesAll(app, buildRegistry(app))).toEqual([
      expect.objectContaining({
        code: 'observesAllUndeclared',
        module: 'quiet',
        ref: 'quiet.audit',
      }),
    ]);
  });

  test('refuses a personal member in the input of a backend command that runs asynchronously, and in a schedule', () => {
    const base = { id: 'jobs', version: '0.1.0' } as never;
    const input = shape({
      userId: field.subject(),
      address: field.string().personal({ subject: 'userId' }),
    });
    const notify = defineCommand(base, {
      execution: 'async',
      scope: 'backend',
      input,
      principal: 'operator',
      decide: () => ({}),
    } as never);
    const nightly = defineSchedule(base, {
      every: '1d',
      invoke: notify,
      scope: 'backend',
    } as never);
    const app = appOf([makeModule(base, { actions: { notify }, schedules: { nightly } })]);
    const problems = m2ComposeChecks.flatMap((check) => check(app, buildRegistry(app)));
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'personalOutsideTenant',
          severity: 'error',
          module: 'jobs',
          ref: 'jobs.notify',
        }),
        expect.objectContaining({
          code: 'personalScheduleInput',
          severity: 'error',
          module: 'jobs',
          ref: 'jobs.nightly',
        }),
      ]),
    );
  });

  test('accepts the m2-parts fixture', () => {
    const app = appOf([m2Parts]);
    const registry = buildRegistry(app);
    for (const check of m2ComposeChecks) expect(check(app, registry)).toEqual([]);
  });

  // Other packages append their own checks to the list, so this names what must be in it.
  test('m2ComposeChecks holds the checks', () => {
    expect(m2ComposeChecks).toEqual(
      expect.arrayContaining([
        checkDeploymentGroups,
        checkObservesAll,
        checkJsonFlagDefaults,
        checkStreamOffload,
        checkStreamDeclarations,
        checkProcessEvents,
      ]),
    );
  });

  test('refuses the default of a json flag that its shape converts, and accepts one it keeps', () => {
    const json = (fallback: unknown) =>
      appOf([
        makeModule({
          id: 'shop',
          flags: {
            layout: defineFlag({
              kind: 'json',
              level: 'tenant',
              purpose: 'operational',
              schema: shape({ size: field.integer().default(3) }),
              default: fallback,
            }),
          },
        }),
      ]);
    const converted = json({});
    expect(checkJsonFlagDefaults(converted, buildRegistry(converted))).toEqual([
      expect.objectContaining({
        code: 'jsonFlagDefaultInvalid',
        severity: 'error',
        module: 'shop',
        ref: 'shop.layout',
      }),
    ]);
    const unchanged = json({ size: 3 });
    expect(checkJsonFlagDefaults(unchanged, buildRegistry(unchanged))).toEqual([]);
  });

  test('refuses the default of a json flag whose shape turns a string into a Temporal value', () => {
    const app = appOf([
      makeModule({
        id: 'shop',
        flags: {
          opens: defineFlag({
            kind: 'json',
            level: 'tenant',
            purpose: 'operational',
            schema: shape({ from: field.date() }),
            default: { from: '2026-11-11' },
          }),
        },
      }),
    ]);
    expect(checkJsonFlagDefaults(app, buildRegistry(app))).toEqual([
      expect.objectContaining({ code: 'jsonFlagDefaultInvalid', ref: 'shop.opens' }),
    ]);
  });

  test('refuses a quota whose declared default does not parse for its kind, and names the ref', () => {
    const app = appOf([
      makeModule({
        id: 'shop',
        quotas: { size: { kind: 'bytes', default: 'ten', level: 'tenant' } },
      }),
    ]);
    expect(checkQuotaDefaults(app, buildRegistry(app))).toEqual([
      expect.objectContaining({
        code: 'quotaDefaultInvalid',
        severity: 'error',
        module: 'shop',
        ref: 'shop.size',
        message: expect.stringContaining("'shop.size'"),
      }),
    ]);
    // The compose list runs it, so defineApp refuses the app.
    expect(m2ComposeChecks.flatMap((check) => check(app, buildRegistry(app)))).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'quotaDefaultInvalid' })]),
    );
    const sound = appOf([
      makeModule({
        id: 'shop',
        quotas: {
          size: { kind: 'bytes', default: '10GiB', level: 'tenant' },
          rate: { kind: 'rate', default: '100/1m', level: 'tenant' },
        },
      }),
    ]);
    expect(checkQuotaDefaults(sound, buildRegistry(sound))).toEqual([]);
  });
});
