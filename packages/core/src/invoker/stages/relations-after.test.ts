import { describe, expect, test } from 'vitest';
import { post } from '../../../test/authorization/post-fixture.ts';
import { actionOf, registryOf } from '../../../test/invoker/invoker-kit.ts';
import type { EntityEntry } from '../../registry/entity-entry.ts';
import type { ScopeTarget } from '../scope-target.ts';
import type { SessionDetails } from '../session-details.ts';
import { relationsAfter } from './relations-after.ts';

function targetNamed(namespace: string, opened: string[]): ScopeTarget {
  return {
    scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
    namespace,
    handle: {
      adapter: {
        unit: (ns: string, _scope: unknown, fn: (unit: unknown) => Promise<unknown>) => {
          opened.push(String(ns));
          return fn({ rows: { matching: () => Promise.resolve(new Set(['x'])) } });
        },
      },
    },
  } as unknown as ScopeTarget;
}

describe('relationsAfter', () => {
  const action = actionOf('doc.count', { kind: 'query' });
  const tenantEntity = { ref: 'doc.post', descriptor: { ...post, tenancy: 'tenant' } };
  const backendEntity = { ref: 'doc.plan', descriptor: { ...post, tenancy: 'backend' } };
  const registry = registryOf([action], {
    entities: new Map([
      ['doc.post', tenantEntity as unknown as EntityEntry],
      ['doc.plan', backendEntity as unknown as EntityEntry],
    ]),
  });
  const node = { op: 'some', relation: 'r' } as never;

  test('a row entity of the backend is answered in the backend store, a tenant one in the tenant store', async () => {
    const opened: string[] = [];
    const details = {
      resolved: {
        target: targetNamed('tenant-ns', opened),
        backendTarget: targetNamed('backend-ns', opened),
      },
    } as unknown as SessionDetails;
    const answer = relationsAfter(registry, action, details);
    await answer('doc.plan', node, ['1']);
    await answer('doc.post', node, ['1']);
    expect(opened).toEqual(['backend-ns', 'tenant-ns']);
  });

  test('a backend-scope action still answers a tenant entity in the tenant store', async () => {
    const opened: string[] = [];
    const backendAction = actionOf('doc.back', { kind: 'query', scope: 'backend' });
    const details = {
      resolved: {
        target: targetNamed('tenant-ns', opened),
        backendTarget: targetNamed('backend-ns', opened),
      },
    } as unknown as SessionDetails;
    await relationsAfter(registry, backendAction, details)('doc.post', node, ['1']);
    expect(opened).toEqual(['tenant-ns']);
  });
});
