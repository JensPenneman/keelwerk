import type { StreamRef } from '@keelwerk/core';

/** A stream that an erasure visited, and whether it answered that the row is the subject's. */
export interface Settled {
  readonly stream: StreamRef;
  readonly owned: boolean;
}
