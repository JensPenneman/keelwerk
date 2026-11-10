import type { WireError } from '../errors/wire-error.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import type { Position } from './position.ts';

/**
 * Consumer checkpoints, leases and parked streams (sections 14.3.2 and 15.2.3). Joins `Unit` as
 * `consumers` in WP-84.
 */
export interface ConsumerStore {
  checkpoint(consumer: string, scopeId: string): Promise<Position | null>;
  /** In the unit of the effects; monotonic: the stored position becomes the greater of it and `to` (S-173). */
  advance(consumer: string, scopeId: string, to: Position): Promise<void>;
  acquireLease(consumer: string, owner: string, ttlMs: number): Promise<boolean>;
  renewLease(consumer: string, owner: string, ttlMs: number): Promise<boolean>;
  park(consumer: string, stream: StreamRef, from: Position, error: WireError): Promise<void>;
  unpark(consumer: string, stream: StreamRef): Promise<Position | null>;
}
