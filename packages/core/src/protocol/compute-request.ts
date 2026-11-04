import type { Request } from './request.ts';

/** `ctx.compute.argon2idHash | argon2idVerify`: answered by a kernel worker pool, off the event loop. */
export interface ComputeRequest<T = unknown> extends Request<T> {
  readonly kind: 'compute';
  readonly op: 'argon2idHash' | 'argon2idVerify';
  readonly args: readonly unknown[];
}
