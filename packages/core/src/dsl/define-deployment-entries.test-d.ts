import { describe, expectTypeOf, test } from 'vitest';
import { byHostname } from './by-hostname.ts';
import { contracts } from './contracts.ts';
import { defineApp } from './define-app.ts';
import { defineDeployment } from './define-deployment.ts';
import { defineModule } from './define-module.ts';
import { defineModuleBase } from './define-module-base.ts';
import { env } from './env.ts';

const blobsUser = defineModule(
  defineModuleBase({ id: 'blob-user', version: '0.1.0', requires: [contracts.blobs] }),
  {},
);
const base = {
  control: { adapter: 'postgres', url: env('KEELWERK_CONTROL_URL') },
  placements: {
    default: { adapter: 'postgres', url: 'postgres://data', strategy: 'shared-tables' },
  },
  tenantResolution: [byHostname()],
} as const;
const factory = { id: 'pglite', dialect: 'postgres', create: () => undefined } as const;

describe('entries without provides', () => {
  test('an entry without provides type-checks beside one that provides', () => {
    const app = defineApp({ id: 'portal', modules: [] });
    const deployment = defineDeployment({
      ...base,
      apps: [app],
      infrastructure: [factory, { kind: 'http', provides: [contracts.httpHost] }],
    });
    expectTypeOf(deployment.kind).toEqualTypeOf<'deployment'>();
  });

  test('entries without provides do not satisfy missingInfrastructure', () => {
    const app = defineApp({ id: 'files', modules: [blobsUser] });
    // @ts-expect-error missingInfrastructure: 'blobs'
    defineDeployment({ ...base, apps: [app], infrastructure: [factory] });
  });
});
