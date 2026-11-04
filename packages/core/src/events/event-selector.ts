import type { StreamRef } from './stream-ref.ts';

/** Which events a read, a head or a wake-up concerns. */
export interface EventSelector {
  readonly streamTypes?: readonly string[];
  readonly partition?: string;
  readonly names?: readonly string[];
  readonly streams?: readonly StreamRef[];
}
