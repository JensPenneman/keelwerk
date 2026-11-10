import { describe, expect, test } from 'vitest';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
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
const members = {
  control: { adapter: 'postgres', url: env('KEELWERK_CONTROL_URL') },
  placements: {
    default: { adapter: 'postgres', url: env('KEELWERK_DATA_URL'), strategy: 'shared-tables' },
  },
  tenantResolution: [byHostname()],
} as const;

const factory = {
  id: 'pglite',
  dialect: 'postgres',
  options: {},
  create: () => {
    throw new Error('not called');
  },
} as const;
const sink = {
  id: 'file',
  append: async () => undefined,
  read: async () => [],
} as const;

describe('entries without provides (open point 458, S-108)', () => {
  test('accepts an adapter factory, a ledger sink and the schema planner, which provide nothing', () => {
    const app = defineApp({ id: 'files', modules: [] });
    expect(() =>
      defineDeployment({
        ...members,
        apps: [app],
        infrastructure: [
          factory,
          sink,
          { kind: 'schemaPlanner' },
          { kind: 'http', provides: [contracts.httpHost] },
        ],
      }),
    ).not.toThrow();
  });

  test('still refuses missingInfrastructure when only entries without provides are listed', () => {
    const app = defineApp({ id: 'files', modules: [blobsUser] });
    const call = () =>
      defineDeployment({
        ...members,
        apps: [app],
        infrastructure: [factory, sink],
      } as never);
    try {
      call();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KeelwerkError);
      expect((error as KeelwerkError).details).toMatchObject({
        code: 'missingInfrastructure',
        ref: 'blobs',
      });
    }
  });
});
