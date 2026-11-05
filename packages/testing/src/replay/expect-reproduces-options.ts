import type { Principal, RequestInfo } from '@keelwerk/core';
import type { TestPrincipal } from '../harness/test-principal.ts';

/** Which recorded command to re-decide, and with what. */
export interface ExpectReproducesOptions {
  readonly commandId: string;
  /** The command's input, which must be the one recorded. */
  readonly input: unknown;
  /** The tenant's name; default: the first. */
  readonly tenant?: string;
  /** Who made the call: a test principal, or a core principal (a caller that holds a session); default: the recorded actor's identity alone. */
  readonly principal?: TestPrincipal | Principal;
  /** What the record does not hold of the request: the user agent and the address a handler read. */
  readonly request?: Pick<RequestInfo, 'userAgent' | 'connection'>;
}
