import { type Contracts, contracts } from '../../src/dsl/contracts.ts';
import type { StubEntry } from './infrastructure-entry.ts';

/** Stand-in for @keelwerk/transport-http: provides contracts.httpHost. */
export function httpHost(options: {
  readonly listen: readonly { readonly port: number }[];
}): StubEntry<readonly [Contracts['httpHost']]> {
  return { kind: `httpHost:${options.listen.length}`, provides: [contracts.httpHost] };
}
