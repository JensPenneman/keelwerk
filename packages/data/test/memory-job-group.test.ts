import { describe, expect, test } from 'vitest';
import { failure } from './support/failure.ts';
import { jobSpec } from './support/job-spec.ts';
import { openMemory } from './support/memory-fixture.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { tenantScope } from './support/tenant-scope.ts';

const group = { id: 'mx:example.com', scope: 'namespace' as const, concurrency: 1 };

describe('provisioning a namespace job group', () => {
  test('a namespace unit provisions it, then a tenant unit enqueues into it', async () => {
    const memory = openMemory();
    await memory.run(namespaceScope, (unit) => unit.jobs.provisionGroup(group));
    expect(await memory.run(tenantScope, (unit) => unit.jobs.enqueue(jobSpec({ group })))).toBe(
      '1',
    );
  });

  test('any other unit is refused, and so is a group of one scope', async () => {
    const memory = openMemory();
    expect(
      (await failure(memory.run(tenantScope, (unit) => unit.jobs.provisionGroup(group)))).kind,
    ).toBe('internal');
    expect(
      (await failure(memory.run(namespaceScope, (unit) => unit.jobs.provisionGroup({ id: 'mx' }))))
        .kind,
    ).toBe('internal');
  });
});
