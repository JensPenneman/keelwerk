import type { Request } from './request.ts';

/** `ctx.flags.<m>.<flag>` or `ctx.flagDetails(key)`: the invocation's flag snapshot (section 20.3). */
export interface FlagRequest<T = unknown> extends Request<T> {
  readonly kind: 'flag';
  readonly key: string;
  /** True for `ctx.flagDetails`, which answers the variant, the reason and the rule version. */
  readonly details: boolean;
}
