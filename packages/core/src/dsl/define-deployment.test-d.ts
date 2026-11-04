import { describe, expectTypeOf, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import type { TenantResolver } from '../edge/tenant-resolver.ts';
import type { DeploymentDefinition } from '../runtime/deployment-definition.ts';
import { byHeader } from './by-header.ts';
import { byHostname } from './by-hostname.ts';
import { contracts } from './contracts.ts';
import { defineApp } from './define-app.ts';
import { type Deployment, type DeploymentChecks, defineDeployment } from './define-deployment.ts';
import { defineModule } from './define-module.ts';
import { defineModuleBase } from './define-module-base.ts';
import { env } from './env.ts';
import { secret } from './secret.ts';

const blobsUser = defineModule(
  defineModuleBase({ id: 'blob-user', version: '0.1.0', requires: [contracts.blobs] }),
  {},
);
const base = {
  control: { adapter: 'postgres', url: env('KEELWERK_CONTROL_URL') },
  placements: {
    default: { adapter: 'postgres', url: 'postgres://data', strategy: 'shared-tables' },
  },
  tenantResolution: [byHostname(), byHeader('x-keelwerk-tenant')],
} as const;

describe('case 14: defineDeployment', () => {
  test('missingInfrastructure, with the exact check type', () => {
    const app = defineApp({ id: 'files', modules: [blobsUser] });
    type Apps = readonly [typeof app];
    expectTypeOf<DeploymentChecks<Apps, readonly []>>().toEqualTypeOf<{
      readonly missingInfrastructure: 'blobs';
    }>();
    expectTypeOf<
      DeploymentChecks<
        Apps,
        readonly [
          { readonly kind: 'http'; readonly provides: readonly [typeof contracts.httpHost] },
        ]
      >
    >().toEqualTypeOf<{ readonly missingInfrastructure: 'blobs' }>();
    expectTypeOf<
      DeploymentChecks<
        Apps,
        readonly [
          { readonly kind: 'blobs-fs'; readonly provides: readonly [typeof contracts.blobs] },
        ]
      >
    >().toEqualTypeOf<unknown>();
    // @ts-expect-error missingInfrastructure: 'blobs'
    defineDeployment({ ...base, apps: [app], infrastructure: [] });
    // @ts-expect-error missingInfrastructure: an entry that provides another contract
    defineDeployment({
      ...base,
      apps: [app],
      infrastructure: [{ kind: 'http', provides: [contracts.httpHost] }],
    });
    defineDeployment({
      ...base,
      apps: [app],
      infrastructure: [{ kind: 'blobs-fs', provides: [contracts.blobs] }],
    });
  });

  test('an app without deployment-level requirements needs no infrastructure', () => {
    const app = defineApp({ id: 'plain', modules: [accounts] });
    defineDeployment({ ...base, apps: [app], infrastructure: [] });
  });

  test('the value is a subtype of what startRuntime takes (S-49)', () => {
    const app = defineApp({ id: 'plain', modules: [accounts] });
    const deployment = defineDeployment({
      ...base,
      apps: [app],
      infrastructure: [],
      operator: { socket: '/run/keelwerk/operator.sock', bootstrapSecret: secret('OPERATOR') },
      keys: { masterKey: secret('MASTER') },
      telemetry: { otlp: env('OTEL_EXPORTER_OTLP_ENDPOINT') },
      rollout: { finalize: 'auto', graceSeconds: 600 },
      anchors: { every: 'batch' },
      queues: { 'mail-delivery': { running: 4, slo: 'PT2M' } },
      scaling: { maxProcesses: 8 },
      processes: { home: { roles: ['serve', 'work'] } },
    });
    expectTypeOf(deployment).toExtend<DeploymentDefinition>();
    expectTypeOf(deployment).toExtend<Deployment>();
    expectTypeOf(deployment.apps[0].id).toEqualTypeOf<'plain'>();
    expectTypeOf(deployment.tenantResolution).toExtend<readonly TenantResolver[]>();
  });

  test('the members of the deployment file are typed', () => {
    const app = defineApp({ id: 'plain', modules: [accounts] });
    defineDeployment({
      ...base,
      apps: [app],
      infrastructure: [],
      // @ts-expect-error a placement needs a known strategy
      placements: { default: { adapter: 'postgres', url: 'x', strategy: 'sharded' } },
    });
    // @ts-expect-error a rollout finalizes 'auto' or 'manual'
    defineDeployment({ ...base, apps: [app], infrastructure: [], rollout: { finalize: 'never' } });
    defineDeployment({
      ...base,
      apps: [app],
      infrastructure: [],
      // @ts-expect-error a process has roles of serve or work
      processes: { w: { roles: ['x'] } },
    });
    defineDeployment({
      ...base,
      apps: [app],
      infrastructure: [],
      // @ts-expect-error slots are numbers per queue
      processes: { w: { roles: ['work'], slots: { '*': 'many' } } },
    });
    defineDeployment({
      ...base,
      apps: [app],
      infrastructure: [],
      processes: {
        w: {
          roles: ['work'],
          capabilities: ['smtp-out'],
          slots: { reactions: 8, '*': 2 },
          placements: ['default'],
          provider: 'docker',
          scale: { min: 0, max: 4 },
          drainSeconds: 60,
        },
      },
      scaling: { maxProcesses: 8, maxCostPerHour: 5, providers: { docker: { max: 4 } } },
    });
    // @ts-expect-error the master key is a secret reference, not a string
    defineDeployment({ ...base, apps: [app], infrastructure: [], keys: { masterKey: 'plain' } });
  });
});

describe('queues.<q>.takeLanes', () => {
  test('is an optional number on a queue declaration', () => {
    type Queue = NonNullable<DeploymentDefinition['queues']>[string];
    expectTypeOf<Queue['takeLanes']>().toEqualTypeOf<number | undefined>();
  });
});
