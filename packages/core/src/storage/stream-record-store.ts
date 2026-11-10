import type { StreamRecord } from './stream-record.ts';

/**
 * Records of declared streams per stream and key (section 14.3.2). Joins `Unit` as `streams` in
 * WP-85.
 */
export interface StreamRecordStore {
  append(
    stream: string,
    key: string,
    records: readonly unknown[],
  ): Promise<{ readonly firstSeq: bigint }>;
  read(
    stream: string,
    key: string,
    afterSeq: bigint | null,
    limit: number,
  ): Promise<readonly StreamRecord[]>;
  expire(
    stream: string,
    policy: { readonly maxAge?: string; readonly maxPerKey?: number },
    limit: number,
  ): Promise<number>;
  /** Erasure and retention. */
  purgeKeys(stream: string, keys: readonly string[]): Promise<number>;
}
