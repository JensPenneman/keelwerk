import type { Scope, StoredJobSpec } from '@keelwerk/core';
import { stamp } from './stamp.ts';
import { tenantScope } from './tenant-scope.ts';

/** A queued action for the first tenant; `over` changes what a test is about. */
export function jobSpec(over: Partial<StoredJobSpec> = {}): StoredJobSpec {
  return {
    queue: 'commands',
    run: { action: 'app.note.set', input: { n: 1 } },
    scope: tenantScope as Scope,
    principal: { resolver: 'system', principalId: 'p' },
    causation: {},
    build: { id: 'b1', revision: 1 },
    kind: 'action',
    laneCap: 10,
    createdAt: stamp,
    ...over,
  };
}
