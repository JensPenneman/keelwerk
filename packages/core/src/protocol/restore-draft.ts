import type { Draft } from './draft.ts';

/** `ctx.write.<m>.<e>.restore(target)`. */
export interface RestoreDraft extends Draft {
  readonly kind: 'restore';
  readonly type: 'restored';
  readonly entity: string;
  readonly id: string;
  readonly expectedVersion?: number;
  readonly values: Readonly<Record<string, unknown>>;
}
