import type { NewEvent } from './new-event.ts';
import type { StreamRef } from './stream-ref.ts';

/** Events appended to one stream in one batch. */
export interface StreamAppend {
  readonly stream: StreamRef;
  /** 0 creates the stream. */
  readonly expectedVersion: number;
  readonly partition: string | null;
  readonly events: readonly NewEvent[];
  /**
   * Set only by the kernel, for a stream that belongs to no entity (a process's state stream,
   * S-124). The store consults no entity descriptor and checks this tenancy against the unit's
   * scope. Absent, the store finds the entity of the stream's type and answers `internal` for an
   * unknown one.
   */
  readonly tenancy?: 'tenant';
}
