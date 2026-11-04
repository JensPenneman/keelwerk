import type { Position } from '../storage/position.ts';

/** The snapshot position one load saw; `scope: 'backend'` marks a load of a backend-level entity. */
export interface RecordedRead {
  readonly scope?: 'backend';
  readonly at: Position;
}
