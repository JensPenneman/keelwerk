import type { ScopeCounters } from '../storage/scope-counters.ts';
import type { EpochBump } from './epoch-bump.ts';
import type { ScopeMark } from './scope-mark.ts';

/** What `epochBumpsOf` decides for one scope: the bump, the mark to write and the counters to raise. */
export interface EpochBumpDecision {
  readonly bump: EpochBump;
  readonly mark: ScopeMark;
  readonly raise: ScopeCounters;
}
