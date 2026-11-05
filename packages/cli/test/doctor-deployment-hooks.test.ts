import type { Unit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { checkDeployment } from '../src/doctor/check-deployment.ts';
import { hookEventTypes } from '../src/doctor/hook-event-types.ts';
import { hookFailuresOf } from '../src/doctor/hook-failures-of.ts';
import { readDeploymentFacts } from '../src/doctor/read-deployment-facts.ts';
import { definitionOf, keyEnvironment } from './support/deployment-definition-of.ts';

describe('failed tenant hooks (S-27)', () => {
  function unitOf(events: readonly { type: string; id: string; hook: unknown }[]): Unit {
    return {
      events: {
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
    expect(failures).toEqual([{ hookId: 'billing.onTenantCreated', tenantId: 'tnt_2' }]);
    const facts = await readDeploymentFacts({
      definition: definitionOf(),
      env: keyEnvironment,
      modeOf: async () => 0o600,
      registries: [],
      capabilities: new Map(),
      reader: {
        reachable: async () => ({ reachable: true, detail: '' }),
        processes: async () => [],
        hookFailures: async () => failures,
      },
    });
    expect(checkDeployment(facts).map((finding) => finding.message)).toContain(
      'the lifecycle hook billing.onTenantCreated failed for tenant tnt_2',
    );
  });
});
