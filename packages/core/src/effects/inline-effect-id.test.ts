import { expect, test } from 'vitest';
import type { Scope } from '../storage/scope.ts';
import { deriveEffectId } from './derive-effect-id.ts';
import { inlineEffectId } from './inline-effect-id.ts';

const scope: Scope = { level: 'deployment' };

test('the inline id derives from the prepare cause', () => {
  expect(inlineEffectId(scope, 'c1', 2)).toBe(deriveEffectId(scope, 'prepare:c1', 2));
});

test('the inline id differs from the decide id at the same index', () => {
  expect(inlineEffectId(scope, 'c1', 0)).not.toBe(deriveEffectId(scope, 'c1', 0));
});
