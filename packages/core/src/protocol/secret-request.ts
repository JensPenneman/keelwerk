import type { Request } from './request.ts';

/** `ctx.secrets.issue | reveal | verify`: answered by the key service. */
export interface SecretRequest<T = unknown> extends Request<T> {
  readonly kind: 'secret';
  readonly op: 'issue' | 'reveal' | 'verify';
  readonly args: readonly unknown[];
}
