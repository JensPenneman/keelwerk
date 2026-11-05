import { describe, expect, test } from 'vitest';
import { receiptScopeId } from './receipt-scope-id.ts';

const deploymentId = '0198a1e0-0000-7000-8000-00000000d001';

describe('the id a scope has in the receipt store', () => {
  test('a tenant and a backend use their own ids', () => {
    expect(receiptScopeId({ level: 'tenant', backendId: 'b1', tenantId: 't1' }, deploymentId)).toBe(
      't1',
    );
    expect(receiptScopeId({ level: 'backend', backendId: 'b1' }, deploymentId)).toBe('b1');
  });

  test('the deployment scope uses the deployment id the mount was given, not a literal', () => {
    expect(receiptScopeId({ level: 'deployment' }, deploymentId)).toBe(deploymentId);
  });
});
