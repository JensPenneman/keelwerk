import type { Draft } from './draft.ts';

/** `ctx.write.<m>.<e>.update(target, patch)`. A draft built from an id carries no expected version (S-21). */
export interface UpdateDraft extends Draft {
  readonly kind: 'update';
  readonly type: 'changed';
  readonly entity: string;
  readonly id: string;
  readonly expectedVersion?: number;
  readonly values: Readonly<Record<string, unknown>>;
}
