import type { Draft } from './draft.ts';

/** `ctx.write.<module>.<stream>.append(key, records)`: records for one key, appended in the decision's unit (G6). */
export interface StreamAppendDraft extends Draft {
  readonly kind: 'append';
  readonly type: 'append';
  /** The stream reference, '<module>.<stream>' (also `target`). */
  readonly stream: string;
  /** The keyed row's id. */
  readonly key: string;
  readonly records: readonly unknown[];
}
