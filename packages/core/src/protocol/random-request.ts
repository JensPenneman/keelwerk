import type { Request } from './request.ts';

/** `ctx.random(bytes)`: bytes from a CSPRNG. */
export interface RandomRequest<T = Uint8Array> extends Request<T> {
  readonly kind: 'random';
  readonly bytes: number;
}
