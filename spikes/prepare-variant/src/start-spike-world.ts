import type { EntityBehaviours, NamespaceRef, Registry, Scope } from '@keelwerk/core';
import { entityBehavioursOf } from '@keelwerk/core';
import type { TestRuntime } from '@keelwerk/testing';
import { startTestRuntime } from '@keelwerk/testing';
import type { SpikeApp } from './spike-app.ts';
import { spikeApp } from './spike-app.ts';

/** The harness runtime of the spike app and the scope its commands run in. */
export interface SpikeWorld {
  readonly runtime: TestRuntime<SpikeApp, 'acme' | 'globex'>;
  readonly registry: Registry;
  readonly namespace: NamespaceRef;
  readonly scope: Scope;
  readonly behaviours: EntityBehaviours;
}

const backendId = '00000000-0000-4000-8000-0000000000b1';

/** Starts the harness runtime on the in-memory adapter and names the first tenant's scope. */
export async function startSpikeWorld(): Promise<SpikeWorld> {
  const runtime = await startTestRuntime(spikeApp);
  const tenant = runtime.tenants.acme;
  return {
    runtime,
    registry: runtime.app.registry,
    namespace: {
      id: `ns-${tenant.id}`,
      placementId: 'main',
      appId: spikeApp.id,
      tenantId: tenant.id,
      root: spikeApp.id,
    },
    scope: { level: 'tenant', backendId, tenantId: tenant.id },
    behaviours: entityBehavioursOf(spikeApp.modules),
  };
}
