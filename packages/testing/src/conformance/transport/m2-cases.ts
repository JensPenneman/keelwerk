import { describe } from 'vitest';
import { selectionCases } from './selection-cases.ts';
import { subscriptionCases } from './subscription-cases.ts';
import type { TransportTarget } from './transport-target.ts';
import { waitEffectsCases } from './wait-effects-cases.ts';

/** The transport cases the second milestone adds, one `describe` per case file. */
export function m2Cases(target: TransportTarget): void {
  describe('subscriptions', () => subscriptionCases(target));
  describe('selection', () => selectionCases(target));
  describe('wait for effects', () => waitEffectsCases(target));
}
