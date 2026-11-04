import type { AnyContract } from '../src/define-contract.ts';

/** An infrastructure entry of the stand-in packages. */
export interface StubEntry<C extends readonly AnyContract[]> {
  readonly kind: string;
  readonly provides: C;
}
