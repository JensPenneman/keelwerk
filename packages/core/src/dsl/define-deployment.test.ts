import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
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

describe('defineDeployment (section 4.6)', () => {
  test('keeps the members of the deployment file and marks the value', () => {
    const app = defineApp({ id: 'portal', modules: [accounts] });
    const deployment = defineDeployment({
      ...members,
      apps: [app],
      infrastructure: [],
      anchors: { every: 'PT1M' },
    });
    expect(deployment.kind).toBe('deployment');
    expect(deployment.apps).toEqual([app]);
    expect(deployment.control).toEqual(members.control);
    expect(deployment.placements).toEqual(members.placements);
    expect(deployment.anchors).toEqual({ every: 'PT1M' });
  });

  test('repeats missingInfrastructure at runtime', () => {
    const app = defineApp({ id: 'files', modules: [blobsUser] });
    // The type check refuses this call; the runtime mirror serves callers without the types.
    const call = () => defineDeployment({ ...members, apps: [app], infrastructure: [] } as never);
    try {
      call();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KeelwerkError);
      expect((error as KeelwerkError).details).toMatchObject({
        code: 'missingInfrastructure',
        module: 'blob-user',
        ref: 'blobs',
      });
    }
  });

  test('accepts an infrastructure entry that provides the contract', () => {
    const app = defineApp({ id: 'files', modules: [blobsUser] });
    expect(() =>
      defineDeployment({
        ...members,
        apps: [app],
        infrastructure: [{ kind: 'blobs-fs', provides: [contracts.blobs] }],
      }),
    ).not.toThrow();
  });
});
