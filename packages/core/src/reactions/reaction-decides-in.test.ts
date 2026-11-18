import { describe, expect, test } from 'vitest';
import type { Scope } from '../storage/scope.ts';
import { reactionDecidesIn } from './reaction-decides-in.ts';

const reaction = { id: 'm.react' };
const tenant: Scope = { level: 'tenant', backendId: 'b-1', tenantId: 't-1' } as Scope;
const backend: Scope = { level: 'backend', backendId: 'b-1' } as Scope;
const deployment: Scope = { level: 'deployment' } as Scope;

describe('reactionDecidesIn', () => {
  test('a reaction decides on an event of a tenant and of a backend', () => {
    expect(reactionDecidesIn(reaction, tenant)).toBe(true);
    expect(reactionDecidesIn(reaction, backend)).toBe(true);
  });

  test('a reaction does not decide on an event of the deployment', () => {
    expect(reactionDecidesIn(reaction, deployment)).toBe(false);
  });
});
