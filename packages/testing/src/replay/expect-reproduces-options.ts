import type { TestPrincipal } from '../harness/test-principal.ts';

/** Which recorded command to re-decide, and with what. */
export interface ExpectReproducesOptions {
  readonly commandId: string;
  /** The command's input, which must be the one recorded. */
  readonly input: unknown;
  /** The tenant's name; default: the first. */
  readonly tenant?: string;
  /** Who made the call; default: the recorded actor's identity alone. */
  readonly principal?: TestPrincipal;
}
