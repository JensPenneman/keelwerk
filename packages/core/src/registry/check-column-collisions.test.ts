import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { field } from '../fields/field.ts';
import { buildRegistry } from './build-registry.ts';

function problemsOf(tenancy: 'tenant' | 'invocation', name: string): readonly string[] {
  const entity = defineEntity({
    prefix: 'tok',
    fields: { [name]: field.string() },
    tenancy,
  });
  return buildRegistry(appOf([makeModule({ id: 'shop', entities: { token: entity } })]))
    .problems.filter((problem) => problem.code === 'columnCollisions')
    .map((problem) => problem.ref ?? '');
}

describe('column collisions of invocation entities (section 14.4.2)', () => {
  test('a field named scopeId collides with the scope column of an invocation table', () => {
    expect(problemsOf('invocation', 'scopeId')).toEqual(['shop.token.scopeId']);
  });

  test('the same field is no collision on a tenant table, whose scope column is tenant_id', () => {
    expect(problemsOf('tenant', 'scopeId')).toEqual([]);
  });

  test('a field named tenantId still collides on an invocation table', () => {
    expect(problemsOf('invocation', 'tenantId')).toEqual(['shop.token.tenantId']);
  });
});
