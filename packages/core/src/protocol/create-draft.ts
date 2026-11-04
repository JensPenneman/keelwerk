import type { Draft } from './draft.ts';

/** `ctx.write.<m>.<e>.create(values)`. */
export interface CreateDraft extends Draft {
  readonly kind: 'create';
  readonly type: 'created';
  readonly entity: string;
  readonly id: string;
  readonly expectedVersion?: number;
  readonly values: Readonly<Record<string, unknown>>;
}
