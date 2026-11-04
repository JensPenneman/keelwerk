import type { Draft } from './draft.ts';

/** `ctx.write.<m>.<e>.archive(target, { reason? })`; `values` holds the reason. */
export interface ArchiveDraft extends Draft {
  readonly kind: 'archive';
  readonly type: 'archived';
  readonly entity: string;
  readonly id: string;
  readonly expectedVersion?: number;
  readonly values: Readonly<Record<string, unknown>>;
}
