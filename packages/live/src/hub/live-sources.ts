import type { LiveHub } from '@keelwerk/core';
import type { ScopeReaders } from './scope-readers.ts';

/**
 * The seam of the sources the hub does not build itself: each member is given the readers of the hub
 * and answers the hub's member of that name. An absent member answers `core.live_unavailable` from
 * `next()`.
 */
export interface LiveSources {
  readonly pokes?: (readers: ScopeReaders) => LiveHub['pokes'];
  readonly stream?: (readers: ScopeReaders) => LiveHub['stream'];
  readonly topic?: (readers: ScopeReaders) => LiveHub['topic'];
}
