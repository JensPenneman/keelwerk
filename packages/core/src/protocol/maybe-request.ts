import type { AnyRequest } from './any-request.ts';
import type { Request } from './request.ts';

/** `ctx.load.<optional module>.ifPresent(f)`: `f`'s request when the module is selected, else `undefined` (decision 32b). */
export interface MaybeRequest<T = unknown> extends Request<T | undefined> {
  readonly kind: 'maybe';
  readonly module: string;
  /** Whether the module is selected; when false the unit is not touched. */
  readonly present: boolean;
  /** `f`'s request; null when the module is absent. */
  readonly inner: AnyRequest | null;
}
