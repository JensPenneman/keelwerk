import { describe, expectTypeOf, test } from 'vitest';
import { defineDeployment } from '../dsl/define-deployment.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import type { Runtime, StartRuntime } from './runtime.ts';
import type { RuntimeOptions } from './runtime-options.ts';
import { startRuntime } from './start-runtime.ts';

const deployment = defineDeployment({
  apps: [],
  infrastructure: [],
  control: { adapter: 'memory', url: 'memory:' },
  placements: { main: { adapter: 'memory', url: 'memory:', strategy: 'shared-tables' } },
  tenantResolution: [],
});

describe('startRuntime (S-49)', () => {
  test('defineDeployment returns a subtype of DeploymentDefinition, which startRuntime takes', () => {
    expectTypeOf(deployment).toExtend<DeploymentDefinition>();
    expectTypeOf(startRuntime).parameter(0).toEqualTypeOf<DeploymentDefinition>();
    expectTypeOf(startRuntime).parameter(1).toEqualTypeOf<RuntimeOptions>();
    expectTypeOf(startRuntime).returns.resolves.toEqualTypeOf<Runtime>();
    expectTypeOf(startRuntime).toExtend<StartRuntime>();
  });

  test('the runtime offers the surface, the registry, the invoker, stop and the control API', () => {
    expectTypeOf<Runtime>().toHaveProperty('invoker');
    expectTypeOf<Runtime['stop']>().parameters.toEqualTypeOf<[deadlineMs: number]>();
    expectTypeOf<Runtime['control']['createTenant']>().returns.resolves.toEqualTypeOf<{
      readonly id: string;
    }>();
  });
});
