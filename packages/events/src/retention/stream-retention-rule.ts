import type { RetentionRunRule, StreamEntry } from '@keelwerk/core';

/** The declared retention of one stream as a run records it. */
export function streamRetentionRule(
  stream: string,
  retention: NonNullable<StreamEntry['retention']>,
): RetentionRunRule {
  return {
    kind: 'streamRecords',
    stream,
    ...(retention.maxAge === undefined ? {} : { maxAge: retention.maxAge }),
    ...(retention.maxPerKey === undefined ? {} : { maxPerKey: retention.maxPerKey }),
  };
}
