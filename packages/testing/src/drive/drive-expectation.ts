import type { DraftMatcher } from './draft-matcher.ts';

/** What a driven `decide` is expected to return. */
export interface DriveExpectation {
  /** The drafts, in order. Default: none. */
  readonly events?: readonly DraftMatcher[];
  /** The result. Default: undefined. */
  readonly result?: unknown;
}
