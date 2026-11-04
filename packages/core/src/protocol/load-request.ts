import type { Request } from './request.ts';

/** `ctx.load.<m>.<e>.byId | one | many | count | exists | query` (S-50). */
export interface LoadRequest<T = unknown> extends Request<T> {
  readonly kind: 'load';
  readonly module: string;
  readonly entity: string;
  readonly op: 'byId' | 'one' | 'many' | 'count' | 'exists' | 'query';
  readonly args: readonly unknown[];
  /** 'module': the module's own authority; 'caller': narrowed by the caller's read plan. */
  readonly view: 'module' | 'caller';
  readonly forUpdate: boolean;
}
