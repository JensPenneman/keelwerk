import type { StreamAppendDraft } from '../protocol/stream-append-draft.ts';

/** The draft constructor of one stream: records for one key, appended in the decision's unit. */
export interface StreamWrites<K, R> {
  append(key: K, records: readonly R[]): StreamAppendDraft;
}
