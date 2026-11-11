import { describe, expect, test } from 'vitest';
import { m2Parts } from '../../test/fixtures/modules/m2-parts/src/module.generated.ts';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineEffect } from '../dsl/define-effect.ts';
import { defineEffectExecutor } from '../dsl/define-effect-executor.ts';
import { defineReaction } from '../dsl/define-reaction.ts';
import { defineStream } from '../dsl/define-stream.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from './build-registry.ts';
import { checkDeploymentGroups } from './check-deployment-groups.ts';
import { checkObservesAll } from './check-observes-all.ts';
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
        checkStreamOffload,
        checkStreamDeclarations,
      ]),
    );
  });
});
