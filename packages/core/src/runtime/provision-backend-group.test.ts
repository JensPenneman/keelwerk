import { expect, test } from 'vitest';
import type { JobGroup } from '../jobs/job-group.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { Connected } from './connected.ts';
import { provisionBackendGroup } from './provision-backend-group.ts';

const namespace = { id: 'ns', placementId: 'p', appId: 'app', tenantId: null, root: 'r' };

function setup(failures = 0) {
  const calls: { scope: StorageScope; group: JobGroup }[] = [];
  let remaining = failures;
  const adapter = {
    unit: async (
      _ns: unknown,
      scope: StorageScope,
      fn: (unit: { jobs: { provisionGroup(group: JobGroup): Promise<void> } }) => Promise<void>,
    ) => {
      if (remaining > 0) {
        remaining -= 1;
        throw new Error('down');
      }
      await fn({
        jobs: {
          provisionGroup: async (group) => {
            calls.push({ scope, group });
          },
        },
      });
    },
  };
  const connected = {
    placements: new Map([['p', { adapter }]]),
  } as unknown as Pick<Connected, 'placements'>;
  return { calls, provision: provisionBackendGroup(connected) };
}

test('a backend group is provisioned in a namespace unit, once per backend', async () => {
  const { calls, provision } = setup();
  await provision({ backendId: 'b1', placementId: 'p', namespace });
  await provision({ backendId: 'b1', placementId: 'p', namespace });
  await provision({ backendId: 'b2', placementId: 'p', namespace });
  expect(calls.map((call) => call.group)).toEqual([
    { id: 'core.cross-scope:b1', concurrency: 4, scope: 'namespace' },
    { id: 'core.cross-scope:b2', concurrency: 4, scope: 'namespace' },
  ]);
  expect(calls.every((call) => call.scope.level === 'namespace')).toBe(true);
});

test('a failed provisioning is forgotten: the next lookup tries again', async () => {
  const { calls, provision } = setup(1);
  await expect(provision({ backendId: 'b1', placementId: 'p', namespace })).rejects.toThrow('down');
  await provision({ backendId: 'b1', placementId: 'p', namespace });
  expect(calls).toHaveLength(1);
});

test('a placement this process did not open is skipped', async () => {
  const { calls, provision } = setup();
  await provision({ backendId: 'b1', placementId: 'elsewhere', namespace });
  expect(calls).toHaveLength(0);
});
