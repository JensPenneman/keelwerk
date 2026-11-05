import { describe } from 'vitest';
import { operatorCases } from './operator-cases.ts';
import type { TransportTarget } from './transport-target.ts';

/** The operator-socket scenarios of the host (16.8.5); the target's codec must be the invocation protocol's. */
export function describeOperatorConformance(target: TransportTarget): void {
  describe(`operator socket: ${target.name}`, () => operatorCases(target));
}
