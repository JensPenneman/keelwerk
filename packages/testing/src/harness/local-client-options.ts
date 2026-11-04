import type { TestPrincipal } from './test-principal.ts';

/** Who a local client calls as, and in which tenant. */
export interface LocalClientOptions<Name extends string = string> {
  readonly principal: TestPrincipal;
  /** The tenant's name in the runtime; default: the first tenant. */
  readonly tenant?: Name;
}
