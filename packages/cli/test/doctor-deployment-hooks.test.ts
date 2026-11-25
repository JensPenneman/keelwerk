import type { Unit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { deploymentGroup } from '../src/doctor/check-deployment.ts';
import { hookEventTypes } from '../src/doctor/hook-event-types.ts';
import { hookFailuresOf } from '../src/doctor/hook-failures-of.ts';
import { known } from '../src/doctor/known.ts';
import { runDeploymentChecks } from '../src/doctor/run-deployment-checks.ts';
import { factsOf } from './support/facts-of.ts';

describe('failed tenant hooks', () => {
  function unitOf(events: readonly { type: string; id: string; hook: unknown }[]): Unit {
    return {
      events: {
        head: async () => null,
        readAll: async () => ({
          events: events.map((event) => ({
            type: event.type,
            stream: { type: 'core.tenant', id: event.id },
            data: { hook: event.hook },
          })),
          next: null,
        }),
      },
    } as unknown as Unit;
  }

  test('doctor reads core.tenant.hookFailed events that no hookCompleted followed', async () => {
    const unit = unitOf([
      { type: hookEventTypes.failed, id: 'tnt_1', hook: 'billing.onTenantCreated' },
      { type: hookEventTypes.failed, id: 'tnt_2', hook: 'billing.onTenantCreated' },
      { type: hookEventTypes.completed, id: 'tnt_1', hook: 'billing.onTenantCreated' },
      { type: hookEventTypes.failed, id: 'tnt_3', hook: 7 },
    ]);
    const failures = await hookFailuresOf(unit);
    expect(failures.failures).toEqual([{ hookId: 'billing.onTenantCreated', tenantId: 'tnt_2' }]);
    const found = runDeploymentChecks(deploymentGroup, factsOf({ hookFailures: known(failures) }));
    expect(found.map((finding) => finding.message)).toContain(
      'the lifecycle hook billing.onTenantCreated failed for tenant tnt_2',
    );
  });

  test('outcomes older than the window doctor read are said not to be read, as a note that counts as checked', () => {
    const found = runDeploymentChecks(
      deploymentGroup,
      factsOf({ hookFailures: known({ failures: [], olderUnread: true }) }),
    );
    expect(found.map((finding) => [finding.severity, finding.subject])).toEqual([
      ['note', 'tenant hooks'],
    ]);
    expect(
      runDeploymentChecks(deploymentGroup, factsOf({})).some(
        (finding) => finding.subject === 'tenant hooks',
      ),
    ).toBe(false);
  });
});
