import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { Condition } from '../conditions/condition.ts';

/** The rules a kernel source's view is compiled from instead of the app's; such a view may enumerate an `invocation` entity. */
export interface LiveKernelAuthority {
  readonly rules: readonly NormalizedRule[];
  /** The members of a row the kernel source reads, hidden ones included: the view presents exactly these. */
  readonly members: readonly string[];
  /** The condition the source applies after the hub: a token of one condition is no token of another. */
  readonly where: Condition | undefined;
}
