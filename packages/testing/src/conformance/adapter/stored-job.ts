import type { StoredJobSpec } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { stamp } from './stamp.ts';

/** A queued action for the first tenant; `over` changes what a case is about. */
export function storedJob(over: Partial<StoredJobSpec> = {}): StoredJobSpec {
  return {
    queue: 'commands',
    run: { action: 'conf.owner.set', input: { n: 1 } },
    scope: conformanceScopes.tenantA,
    principal: { resolver: 'system', principalId: 'p' },
    causation: {},
    build: { id: 'b1', revision: 1 },
    kind: 'action',
    laneCap: 10,
    createdAt: stamp,
    ...over,
  };
}
